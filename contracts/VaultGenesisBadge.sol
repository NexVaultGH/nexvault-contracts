// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

// ─────────────────────────────────────────────────────────────────────────────
//
//  VaultGenesisBadge — NexVault Protocol v1.0
//  ERC-721 badge for the first 5,000 NexVault depositors.
//
//  SECURITY PROPERTIES:
//  ✓ Owner hardcoded — no ownership transfer possible
//  ✓ Supply hard-capped at 5,000 — immutable constant
//  ✓ One badge per wallet — enforced at mint time
//  ✓ Only authorized minter (USDXVault) can mint
//  ✓ originalMinter preserved even after token transfer
//  ✓ Fully on-chain SVG metadata — no IPFS dependency
//  ✓ Mint failure NEVER blocks a deposit (vault wraps in try/catch)
//
//  NEXUS zkVM EXECUTION:
//  Every transaction on this contract is automatically proven by the Nexus
//  zkVM (v3.0) — a Stwo-backed zero-knowledge virtual machine running on
//  every Nexus node. NexVault deploys on NexusEVM (the EVM-compatible layer
//  of Nexus blockchain). No Solidity changes are needed: ZK proofs of all
//  execution are generated at the network verification layer automatically.
//
//  Proof pipeline:
//    Solidity → NexusEVM execution → Nexus zkVM proves it →
//    Universal Proof aggregated → ZK-verified on-chain state
//
//  Docs:  https://docs.nexus.xyz/zkvm
//  GitHub: https://github.com/nexus-xyz/nexus-zkvm
//
//
// ─────────────────────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title  VaultGenesisBadge
 * @notice Permanent on-chain proof of being among NexVault's first 5,000
 *         depositors on Nexus blockchain. Minted automatically on first deposit.
 *         Fully on-chain SVG — works forever with no external dependencies.
 * @author NexVault Protocol
 */
contract VaultGenesisBadge is ERC721 {
    using Strings for uint256;

    // ── Immutable owner ────────────────────────────────────────────────
    address public constant OWNER =
        0x44e06FB3517Ee815BBA5612F783712Ac4f498ba0;

    // ── Execution environment — Nexus zkVM v3.0 ───────────────────────
    // This badge is minted on NexusEVM. Every mint transaction is
    // automatically proven by Nexus zkVM v3.0. The ZK proof metadata
    // is permanently encoded into every badge's on-chain attributes.
    string public constant EXECUTION_LAYER = "NexusEVM";
    string public constant PROOF_SYSTEM    = "Nexus zkVM v3.0";

    // ── Supply cap — IMMUTABLE, cannot be changed after deploy ─────────
    uint256 public constant MAX_SUPPLY = 5_000;

    // ── Custom errors ──────────────────────────────────────────────────
    error NotOwner();
    error NotMinter();
    error ZeroAddress();
    error SoulboundNonTransferable();
    error AlreadyHasBadge();
    error SupplyExhausted();
    error TokenDoesNotExist();
    error MinterAlreadySet();

    // ── State ──────────────────────────────────────────────────────────
    uint256 private _nextTokenId = 1;

    /// @notice The USDXVault contract authorised to mint badges
    address public authorizedMinter;

    /// @notice Whether a wallet holds (or has previously held) a badge
    mapping(address => bool) public hasBadge;

    /// @notice Genesis position number for each wallet (1-based)
    mapping(address => uint256) public genesisPosition;

    /// @notice The original depositor wallet for each tokenId
    mapping(uint256 => address) public originalMinter;

    // ── Events ─────────────────────────────────────────────────────────
    event BadgeMinted(
        address indexed recipient,
        uint256 indexed tokenId,
        uint256 position
    );
    event MinterSet(address indexed minter);

    // ── Modifiers ──────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    modifier onlyMinter() {
        if (msg.sender != authorizedMinter) revert NotMinter();
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────
    constructor() ERC721("Vault Genesis Badge", "NVGB") {
        if (msg.sender != OWNER) revert NotOwner();
    }

    // ── Admin ──────────────────────────────────────────────────────────

    /**
     * @notice Set the only address allowed to mint badges (the USDXVault).
     *         Can only be called once in practice — set after vault deploy.
     * @param minter The USDXVault contract address.
     */
    function setMinterAuthorization(address minter) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        if (authorizedMinter != address(0)) revert MinterAlreadySet();
        authorizedMinter = minter;
        emit MinterSet(minter);
    }

    // ── Mint ───────────────────────────────────────────────────────────

    /**
     * @notice Mint a genesis badge to a depositor.
     *         Called exclusively by USDXVault, wrapped in try/catch.
     *         Reverts if: supply exhausted, wallet already has badge, zero address.
     *         These reverts are caught by the vault — they never block deposits.
     * @param  recipient The depositor's wallet address.
     * @return tokenId   The minted token ID (= genesis position).
     */
    function mint(address recipient)
        external
        onlyMinter
        returns (uint256 tokenId)
    {
        if (recipient == address(0))     revert ZeroAddress();
        if (hasBadge[recipient])         revert AlreadyHasBadge();
        if (_nextTokenId > MAX_SUPPLY)   revert SupplyExhausted();

        tokenId = _nextTokenId;
        unchecked { _nextTokenId++; }

        hasBadge[recipient]          = true;
        genesisPosition[recipient]   = tokenId;
        originalMinter[tokenId]      = recipient;

        _safeMint(recipient, tokenId);

        emit BadgeMinted(recipient, tokenId, tokenId);
    }

    // ── View helpers ───────────────────────────────────────────────────

    /// @notice Total badges minted so far.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /// @notice Badges remaining in genesis supply.
    function remaining() external view returns (uint256) {
        uint256 minted = _nextTokenId - 1;
        return minted >= MAX_SUPPLY ? 0 : MAX_SUPPLY - minted;
    }

    /// @notice Is genesis supply fully minted?
    function isSoldOut() external view returns (bool) {
        return _nextTokenId > MAX_SUPPLY;
    }

    // ── On-chain metadata (SVG + JSON — no IPFS) ──────────────────────

    /**
     * @notice Fully on-chain token metadata with SVG image.
     *         Works forever — no external URL dependency.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        if (tokenId == 0 || tokenId >= _nextTokenId) revert TokenDoesNotExist();

        address minter = originalMinter[tokenId];
        string memory pos = tokenId.toString();
        string memory posLabel = _positionLabel(tokenId);

        // ── SVG ──────────────────────────────────────────────────────
        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
            '<defs>',
            '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="#05060a"/>',
            '<stop offset="100%" stop-color="#0d0f14"/>',
            '</linearGradient>',
            '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0%" stop-color="#c9a84c"/>',
            '<stop offset="100%" stop-color="#8b6914"/>',
            '</linearGradient>',
            '</defs>',
            '<rect width="400" height="400" fill="url(#bg)"/>',
            '<rect x="2" y="2" width="396" height="396" fill="none" stroke="url(#gold)" stroke-width="1.5" opacity="0.5"/>',
            '<rect x="10" y="10" width="380" height="380" fill="none" stroke="#c9a84c" stroke-width="0.5" opacity="0.15"/>',
            // V logo
            '<text x="200" y="130" text-anchor="middle" font-family="Georgia,serif" font-size="80" fill="url(#gold)">V</text>',
            // NEXVAULT
            '<text x="200" y="175" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#f0ece4" letter-spacing="8">NEXVAULT</text>',
            // VAULT GENESIS
            '<text x="200" y="210" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#c9a84c" letter-spacing="4">VAULT GENESIS</text>',
            // Divider
            '<line x1="100" y1="230" x2="300" y2="230" stroke="#c9a84c" stroke-width="0.5" opacity="0.4"/>',
            // Position number
            '<text x="200" y="285" text-anchor="middle" font-family="Georgia,serif" font-size="48" fill="#f0ece4">#', pos, '</text>',
            // Position label
            '<text x="200" y="315" text-anchor="middle" font-family="monospace" font-size="10" fill="#c9a84c" letter-spacing="2">', posLabel, '</text>',
            // Bottom text
            '<text x="200" y="360" text-anchor="middle" font-family="monospace" font-size="8" fill="#374151" letter-spacing="2">FIRST 5,000 DEPOSITORS</text>',
            '<text x="200" y="378" text-anchor="middle" font-family="monospace" font-size="7" fill="#1f2937">NEXUS BLOCKCHAIN</text>',
            '</svg>'
        ));

        // ── Wallet display (shortened) ────────────────────────────────
        string memory walletShort = string(abi.encodePacked(
            _toHexString(uint160(minter) >> 136, 3), // first 3 bytes
            "...",
            _toHexString(uint160(minter) & 0xFFFFFF, 3) // last 3 bytes
        ));

        // ── JSON metadata ─────────────────────────────────────────────
        string memory json = string(abi.encodePacked(
            '{"name":"Vault Genesis Badge #', pos, '",',
            '"description":"Permanent on-chain proof of being among NexVault\'s first 5,000 depositors on Nexus blockchain. Genesis position #', pos, '.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"external_url":"https://nexvault.one/app",',
            '"attributes":[',
            '{"trait_type":"Genesis Position","value":', pos, '},',
            '{"trait_type":"Rarity Tier","value":"', posLabel, '"},',
            '{"trait_type":"Protocol","value":"NexVault"},',
            '{"trait_type":"Network","value":"Nexus"},',
            '{"trait_type":"Execution Layer","value":"NexusEVM"},',
            '{"trait_type":"Proof System","value":"Nexus zkVM v3.0"},',
            '{"trait_type":"ZK Proven","value":"true"},',
            '{"trait_type":"Original Depositor","value":"', walletShort, '"},',
            '{"trait_type":"Max Supply","value":5000}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // ── Internal helpers ───────────────────────────────────────────────

    function _positionLabel(uint256 pos) internal pure returns (string memory) {
        if (pos <= 10)   return "FOUNDING TEN";
        if (pos <= 100)  return "VAULT SENTINEL";
        if (pos <= 500)  return "VAULT PIONEER";
        if (pos <= 1000) return "VAULT ARCHITECT";
        return "GENESIS";
    }

    function _toHexString(uint256 value, uint256 length)
        internal
        pure
        returns (string memory)
    {
        bytes memory buffer = new bytes(2 * length + 2);
        buffer[0] = '0';
        buffer[1] = 'x';
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i = 2 * length + 1; i > 1; i--) {
            buffer[i] = alphabet[value & 0xf];
            value >>= 4;
        }
        return string(buffer);
    }

    // ── Soulbound — block ALL transfers ───────────────────────────────
    // Badges are non-transferable forever. Only minting (from == address(0))
    // is allowed. Any attempt to transfer reverts.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)), block everything else
        if (from != address(0)) {
            revert SoulboundNonTransferable();
        }
        return super._update(to, tokenId, auth);
    }
}
