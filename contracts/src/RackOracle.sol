// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title RackOracle
/// @notice Multi-publisher price oracle for GPU rental rates, in USD per GPU-hour with 6 decimals.
///
/// Time is divided into fixed-length epochs per feed (1 hour for real feeds, 30 s for demo feeds).
/// Allowlisted publishers submit one price per epoch. Epochs are finalized strictly in order:
///   - at least `minPublishers` submissions: take the median, then apply the bounds and jump checks;
///   - otherwise the epoch is recorded as a gap. Prices are never interpolated.
/// Cumulative sums over finalized epochs let settlement read any window average in O(1).
///
/// Admin powers (owner): create feeds, add or remove publishers, log scenarios on demo feeds.
/// A feed's bounds, timing and jump limit are immutable once it is created.
contract RackOracle is Ownable2Step {
    uint8 public constant MAX_PUBLISHERS = 7;
    /// @dev After this many consecutive jump rejections the next valid median is accepted,
    ///      so a genuine regime change cannot freeze the feed.
    uint8 public constant MAX_CONSECUTIVE_JUMP_REJECTS = 3;
    uint16 internal constant BPS = 10_000;

    enum EpochStatus {
        Open,
        Printed,
        Missing,
        RejectedBounds,
        RejectedJump
    }

    struct FeedConfig {
        uint64 genesis; // timestamp of epoch 0
        uint32 epochLength; // seconds
        uint32 finalizeDelay; // seconds after epoch end before an incomplete epoch can be finalized
        uint8 minPublishers;
        uint16 maxJumpBps; // 0 disables the jump check
        uint64 minPrice;
        uint64 maxPrice;
        bool isDemo;
    }

    struct Feed {
        bool exists;
        bool isDemo;
        uint8 minPublishers;
        uint8 publisherCount;
        uint8 consecutiveJumpRejects;
        uint16 maxJumpBps;
        uint32 epochLength;
        uint32 finalizeDelay;
        uint64 genesis;
        uint64 firstEpoch;
        uint64 nextEpoch;
        uint64 minPrice;
        uint64 maxPrice;
        uint64 lastPrice;
    }

    struct EpochData {
        EpochStatus status;
        uint8 count;
        uint64 price;
        uint64[MAX_PUBLISHERS] values;
    }

    struct Cumulative {
        uint128 sum;
        uint64 printed;
    }

    struct SeedCommit {
        bytes32 hash;
        uint64 revealAfter;
        bool revealed;
    }

    mapping(bytes32 feedId => Feed) internal _feeds;
    mapping(bytes32 feedId => mapping(address => bool)) public isPublisher;
    mapping(bytes32 feedId => mapping(uint64 epoch => EpochData)) internal _epochs;
    mapping(bytes32 feedId => mapping(uint64 epoch => mapping(address => bool))) public hasSubmitted;
    mapping(bytes32 feedId => mapping(uint64 epoch => Cumulative)) internal _cumulative;
    mapping(bytes32 feedId => mapping(uint64 periodId => mapping(address => SeedCommit))) public seedCommits;

    event FeedCreated(bytes32 indexed feedId, FeedConfig config, uint64 firstEpoch);
    event PublisherSet(bytes32 indexed feedId, address indexed publisher, bool allowed);
    event PriceSubmitted(bytes32 indexed feedId, uint64 indexed epoch, address indexed publisher, uint64 price);
    event EpochFinalized(bytes32 indexed feedId, uint64 indexed epoch, EpochStatus status, uint64 price, uint8 submissions);
    event SeedCommitted(bytes32 indexed feedId, uint64 indexed periodId, address indexed publisher, bytes32 hash, uint64 revealAfter);
    event SeedRevealed(bytes32 indexed feedId, uint64 indexed periodId, address indexed publisher, bytes32 seed);
    event Scenario(bytes32 indexed feedId, uint64 indexed epoch, uint8 kind);

    error FeedExists();
    error FeedNotFound();
    error InvalidConfig();
    error NotPublisher();
    error TooManyPublishers();
    error EpochNotStarted();
    error EpochAlreadyFinalized();
    error AlreadySubmitted();
    error ZeroPrice();
    error EpochNotFinalizable();
    error InvalidWindow();
    error NotDemoFeed();
    error SeedAlreadyCommitted();
    error SeedNotCommitted();
    error SeedRevealTooEarly();
    error SeedAlreadyRevealed();
    error SeedMismatch();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    function createFeed(bytes32 feedId, FeedConfig calldata cfg) external onlyOwner {
        if (_feeds[feedId].exists) revert FeedExists();
        if (
            cfg.epochLength == 0 || cfg.minPublishers == 0 || cfg.minPublishers > MAX_PUBLISHERS
                || cfg.minPrice == 0 || cfg.maxPrice <= cfg.minPrice || cfg.genesis > block.timestamp
        ) revert InvalidConfig();

        uint64 first = uint64((block.timestamp - cfg.genesis) / cfg.epochLength);
        _feeds[feedId] = Feed({
            exists: true,
            isDemo: cfg.isDemo,
            minPublishers: cfg.minPublishers,
            publisherCount: 0,
            consecutiveJumpRejects: 0,
            maxJumpBps: cfg.maxJumpBps,
            epochLength: cfg.epochLength,
            finalizeDelay: cfg.finalizeDelay,
            genesis: cfg.genesis,
            firstEpoch: first,
            nextEpoch: first,
            minPrice: cfg.minPrice,
            maxPrice: cfg.maxPrice,
            lastPrice: 0
        });
        emit FeedCreated(feedId, cfg, first);
    }

    function setPublisher(bytes32 feedId, address publisher, bool allowed) external onlyOwner {
        Feed storage f = _feed(feedId);
        bool current = isPublisher[feedId][publisher];
        if (current == allowed) return;
        if (allowed) {
            if (f.publisherCount >= MAX_PUBLISHERS) revert TooManyPublishers();
            f.publisherCount++;
        } else {
            f.publisherCount--;
        }
        isPublisher[feedId][publisher] = allowed;
        emit PublisherSet(feedId, publisher, allowed);
    }

    /// @notice Log a demo scenario (e.g. spike or crash) that publisher bots follow. Demo feeds only.
    function scenario(bytes32 feedId, uint8 kind) external onlyOwner {
        Feed storage f = _feed(feedId);
        if (!f.isDemo) revert NotDemoFeed();
        emit Scenario(feedId, _currentEpoch(f), kind);
    }

    // ------------------------------------------------------------------
    // Publishing
    // ------------------------------------------------------------------

    function submit(bytes32 feedId, uint64 epoch, uint64 price) external {
        Feed storage f = _feed(feedId);
        if (!isPublisher[feedId][msg.sender]) revert NotPublisher();
        if (price == 0) revert ZeroPrice();
        if (epoch < f.nextEpoch) revert EpochAlreadyFinalized();
        if (_epochStart(f, epoch) > block.timestamp) revert EpochNotStarted();
        if (hasSubmitted[feedId][epoch][msg.sender]) revert AlreadySubmitted();

        EpochData storage e = _epochs[feedId][epoch];
        hasSubmitted[feedId][epoch][msg.sender] = true;
        e.values[e.count] = price;
        e.count++;
        emit PriceSubmitted(feedId, epoch, msg.sender, price);

        // Finalize eagerly once every publisher has reported for the next epoch in line.
        if (epoch == f.nextEpoch && e.count == f.publisherCount) {
            _finalizeNext(feedId, f);
        }
    }

    /// @notice Finalize up to `maxEpochs` pending epochs in order. Permissionless.
    /// @return finalized number of epochs finalized in this call
    function finalize(bytes32 feedId, uint64 maxEpochs) external returns (uint64 finalized) {
        Feed storage f = _feed(feedId);
        while (finalized < maxEpochs && _canFinalize(feedId, f, f.nextEpoch)) {
            _finalizeNext(feedId, f);
            finalized++;
        }
        if (finalized == 0) revert EpochNotFinalizable();
    }

    function commitSeed(bytes32 feedId, uint64 periodId, bytes32 hash, uint64 revealAfter) external {
        _feed(feedId);
        if (!isPublisher[feedId][msg.sender]) revert NotPublisher();
        SeedCommit storage s = seedCommits[feedId][periodId][msg.sender];
        if (s.hash != bytes32(0)) revert SeedAlreadyCommitted();
        s.hash = hash;
        s.revealAfter = revealAfter;
        emit SeedCommitted(feedId, periodId, msg.sender, hash, revealAfter);
    }

    function revealSeed(bytes32 feedId, uint64 periodId, bytes32 seed) external {
        SeedCommit storage s = seedCommits[feedId][periodId][msg.sender];
        if (s.hash == bytes32(0)) revert SeedNotCommitted();
        if (s.revealed) revert SeedAlreadyRevealed();
        if (block.timestamp < s.revealAfter) revert SeedRevealTooEarly();
        if (keccak256(abi.encodePacked(seed)) != s.hash) revert SeedMismatch();
        s.revealed = true;
        emit SeedRevealed(feedId, periodId, msg.sender, seed);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getFeed(bytes32 feedId) external view returns (Feed memory) {
        return _feeds[feedId];
    }

    function getEpoch(bytes32 feedId, uint64 epoch)
        external
        view
        returns (EpochStatus status, uint8 count, uint64 price)
    {
        EpochData storage e = _epochs[feedId][epoch];
        return (e.status, e.count, e.price);
    }

    function currentEpoch(bytes32 feedId) external view returns (uint64) {
        return _currentEpoch(_feed(feedId));
    }

    function epochStart(bytes32 feedId, uint64 epoch) external view returns (uint256) {
        return _epochStart(_feed(feedId), epoch);
    }

    function canFinalize(bytes32 feedId) external view returns (bool) {
        Feed storage f = _feed(feedId);
        return _canFinalize(feedId, f, f.nextEpoch);
    }

    /// @notice Sum and count of printed prices over the finalized window [from, to], inclusive.
    /// @return sum sum of printed prices
    /// @return printed number of printed epochs
    /// @return total number of epochs in the window
    function windowStats(bytes32 feedId, uint64 from, uint64 to)
        external
        view
        returns (uint256 sum, uint256 printed, uint256 total)
    {
        Feed storage f = _feed(feedId);
        if (from < f.firstEpoch || to < from || to >= f.nextEpoch) revert InvalidWindow();
        Cumulative memory hi = _cumulative[feedId][to];
        Cumulative memory lo = from == f.firstEpoch ? Cumulative(0, 0) : _cumulative[feedId][from - 1];
        sum = hi.sum - lo.sum;
        printed = hi.printed - lo.printed;
        total = uint256(to - from) + 1;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _feed(bytes32 feedId) internal view returns (Feed storage f) {
        f = _feeds[feedId];
        if (!f.exists) revert FeedNotFound();
    }

    function _epochStart(Feed storage f, uint64 epoch) internal view returns (uint256) {
        return uint256(f.genesis) + uint256(epoch) * f.epochLength;
    }

    function _currentEpoch(Feed storage f) internal view returns (uint64) {
        return uint64((block.timestamp - f.genesis) / f.epochLength);
    }

    function _canFinalize(bytes32 feedId, Feed storage f, uint64 epoch) internal view returns (bool) {
        uint256 start = _epochStart(f, epoch);
        if (start > block.timestamp) return false;
        if (f.publisherCount > 0 && _epochs[feedId][epoch].count >= f.publisherCount) return true;
        return block.timestamp >= start + f.epochLength + f.finalizeDelay;
    }

    function _finalizeNext(bytes32 feedId, Feed storage f) internal {
        uint64 epoch = f.nextEpoch;
        EpochData storage e = _epochs[feedId][epoch];
        EpochStatus status;
        uint64 price;

        if (e.count < f.minPublishers) {
            status = EpochStatus.Missing;
        } else {
            price = _median(e.values, e.count);
            if (price < f.minPrice || price > f.maxPrice) {
                status = EpochStatus.RejectedBounds;
            } else if (_isJump(f, price) && f.consecutiveJumpRejects < MAX_CONSECUTIVE_JUMP_REJECTS) {
                status = EpochStatus.RejectedJump;
                f.consecutiveJumpRejects++;
            } else {
                status = EpochStatus.Printed;
                f.lastPrice = price;
                f.consecutiveJumpRejects = 0;
            }
        }

        Cumulative memory prev = epoch == f.firstEpoch ? Cumulative(0, 0) : _cumulative[feedId][epoch - 1];
        if (status == EpochStatus.Printed) {
            _cumulative[feedId][epoch] = Cumulative(prev.sum + price, prev.printed + 1);
        } else {
            _cumulative[feedId][epoch] = prev;
            price = 0;
        }

        e.status = status;
        e.price = price;
        f.nextEpoch = epoch + 1;
        emit EpochFinalized(feedId, epoch, status, price, e.count);
    }

    function _isJump(Feed storage f, uint64 price) internal view returns (bool) {
        uint64 last = f.lastPrice;
        if (f.maxJumpBps == 0 || last == 0) return false;
        uint256 diff = price > last ? price - last : last - price;
        return diff * BPS > uint256(f.maxJumpBps) * last;
    }

    /// @dev Median of the first `n` values (n >= 1). Even n: mean of the two middle values.
    function _median(uint64[MAX_PUBLISHERS] storage vals, uint8 n) internal view returns (uint64) {
        uint64[] memory a = new uint64[](n);
        for (uint256 i; i < n; ++i) {
            uint64 v = vals[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > v) {
                a[j] = a[j - 1];
                --j;
            }
            a[j] = v;
        }
        uint256 mid = n / 2;
        if (n % 2 == 1) return a[mid];
        return uint64((uint256(a[mid - 1]) + a[mid]) / 2);
    }
}
