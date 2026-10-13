// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Farm2Fork
/// Backend-relayed blockchain record.
/// Normal users do NOT need Ethereum wallets.
contract FoodSupplyChain {
    enum Role {
        None,
        Farmer,
        Processor,
        Distributor,
        Retailer,
        Consumer,
        Regulator
    }

    enum Stage {
        Farm,
        Processing,
        Distribution,
        Retail,
        Sold
    }

    struct Batch {
        uint id;
        string commodity;
        string product;
        uint quantity;
        string origin;

        bytes32 owner;
        Stage stage;

        bool isProduct;
        bool consumed;

        uint[] parents;

        uint labScore;
        string reportCid;

        uint risk;
        bool flagged;

        bool recalled;
        string recallReason;

        uint createdAt;
    }

    struct Step {
        Stage stage;
        bytes32 by;
        bytes32 to;
        int tempDev;
        uint hrs;
        string note;
        uint ts;
    }

    uint public count;
    uint public constant FLAG_AT = 60;

    address public regulator;
    address public relayer;

    mapping(bytes32 => Role) public roles;
    mapping(bytes32 => uint) public reputation;

    mapping(Role => bytes32[]) private holders;
    mapping(uint => Batch) private batches;
    mapping(uint => Step[]) private steps;

    event RoleAssigned(bytes32 indexed userId, Role role);
    event BatchRegistered(
        uint indexed id,
        string commodity,
        bytes32 indexed farmer
    );
    event ProductCreated(
        uint indexed id,
        string product,
        uint[] parents
    );
    event Transferred(
        uint indexed id,
        Stage stage,
        bytes32 indexed from,
        bytes32 indexed to
    );
    event RiskUpdated(
        uint indexed id,
        uint risk,
        bool flagged
    );
    event Recalled(
        uint indexed id,
        string reason
    );

    modifier only(Role r) {
        require(roles[_addressToUserId(msg.sender)] == r, "Not authorised");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Only relayer");
        _;
    }

    modifier live(uint id) {
        require(
            id > 0 && id <= count,
            "No such batch"
        );

        require(
            !batches[id].recalled,
            "Batch recalled"
        );

        _;
    }

    constructor(address _relayer) {
        require(
            _relayer != address(0),
            "Invalid relayer"
        );

        regulator = msg.sender;
        relayer = _relayer;
    }

    // ---------------------------------------------------------------------
    // INTERNAL ID HELPERS
    // ---------------------------------------------------------------------

    function _addressToUserId(address a)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "REGULATOR",
                a
            )
        );
    }

    // ---------------------------------------------------------------------
    // REGULATOR / ROLE MANAGEMENT
    // ---------------------------------------------------------------------

    function assignRole(
        bytes32 userId,
        Role r,
        uint rep
    )
        external
        onlyRelayer
    {
        require(
            userId != bytes32(0),
            "Invalid user ID"
        );

        require(
            roles[userId] == Role.None,
            "User already assigned"
        );

        require(
            r != Role.None &&
            r != Role.Regulator,
            "Invalid role"
        );

        require(
            rep <= 100,
            "0-100"
        );

        roles[userId] = r;
        reputation[userId] = rep;

        holders[r].push(userId);

        emit RoleAssigned(
            userId,
            r
        );
    }

    function setReputation(
        bytes32 userId,
        uint rep
    )
        external
        onlyRelayer
    {
        require(
            roles[userId] != Role.None,
            "Unknown user"
        );

        require(
            rep <= 100,
            "0-100"
        );

        reputation[userId] = rep;
    }

    // ---------------------------------------------------------------------
    // FARMER
    // ---------------------------------------------------------------------

    function registerBatchByRelayer(
        bytes32 farmer,
        string memory commodity,
        uint qty,
        string memory origin,
        uint labScore,
        string memory cid
    )
        external
        onlyRelayer
        returns (uint id)
    {
        require(
            roles[farmer] == Role.Farmer,
            "User is not Farmer"
        );

        id = ++count;

        Batch storage b = batches[id];

        b.id = id;
        b.commodity = commodity;
        b.product = commodity;
        b.quantity = qty;
        b.origin = origin;

        b.owner = farmer;
        b.stage = Stage.Farm;

        b.isProduct = false;
        b.consumed = false;

        b.labScore = labScore;
        b.reportCid = cid;

        b.createdAt = block.timestamp;

        emit BatchRegistered(
            id,
            commodity,
            farmer
        );
    }

    // ---------------------------------------------------------------------
    // PROCESSOR
    // ---------------------------------------------------------------------

    function processBatchByRelayer(
        bytes32 processor,
        uint[] memory ins,
        string memory product,
        uint qty,
        uint labScore,
        string memory cid
    )
        external
        onlyRelayer
        returns (uint id)
    {
        require(
            roles[processor] == Role.Processor,
            "User is not Processor"
        );

        require(
            ins.length > 0,
            "No inputs"
        );

        id = ++count;

        Batch storage b = batches[id];

        for (uint i = 0; i < ins.length; i++) {
            Batch storage r = batches[ins[i]];

            require(
                r.owner == processor,
                "Processor does not own input"
            );

            require(
                r.stage == Stage.Processing,
                "Input not at processing stage"
            );

            require(
                !r.isProduct,
                "Input already product"
            );

            require(
                !r.consumed,
                "Input already consumed"
            );

            require(
                !r.recalled,
                "Input recalled"
            );

            r.consumed = true;

            b.parents.push(ins[i]);
        }

        b.id = id;
        b.commodity = batches[ins[0]].commodity;
        b.product = product;
        b.quantity = qty;

        b.origin = "Processing unit";

        b.owner = processor;
        b.stage = Stage.Processing;

        b.isProduct = true;
        b.consumed = false;

        b.labScore = labScore;
        b.reportCid = cid;

        b.createdAt = block.timestamp;

        emit ProductCreated(
            id,
            product,
            b.parents
        );
    }

    // ---------------------------------------------------------------------
    // TRANSFER
    // ---------------------------------------------------------------------

    function transferByRelayer(
        bytes32 sender,
        uint id,
        bytes32 to,
        int tempDev,
        uint hrs,
        string calldata note
    )
        external
        onlyRelayer
        live(id)
    {
        Batch storage b = batches[id];

        Stage s = b.stage;

        require(
            b.owner == sender,
            "Not owner"
        );

        require(
            !b.consumed,
            "Batch consumed"
        );

        require(
            uint(s) < 3,
            "Cannot transfer further"
        );

        require(
            s == Stage.Farm || b.isProduct,
            "Raw batch must be processed"
        );

        Role senderRole = roles[sender];
        Role recipientRole = roles[to];

        require(
            uint(senderRole) == uint(s) + 1,
            "Wrong sender role"
        );

        require(
            uint(recipientRole) == uint(s) + 2,
            "Recipient has wrong role"
        );

        steps[id].push(
            Step(
                s,
                sender,
                to,
                tempDev,
                hrs,
                note,
                block.timestamp
            )
        );

        b.owner = to;
        b.stage = Stage(
            uint(s) + 1
        );

        emit Transferred(
            id,
            b.stage,
            sender,
            to
        );
    }

    // ---------------------------------------------------------------------
    // RETAILER / SALE
    // ---------------------------------------------------------------------

    function sellByRelayer(
        bytes32 retailer,
        uint id,
        int tempDev,
        uint hrs
    )
        external
        onlyRelayer
        live(id)
    {
        require(
            roles[retailer] == Role.Retailer,
            "User is not Retailer"
        );

        Batch storage b = batches[id];

        require(
            b.owner == retailer &&
            b.stage == Stage.Retail,
            "Not sellable"
        );

        steps[id].push(
            Step(
                Stage.Retail,
                retailer,
                bytes32(0),
                tempDev,
                hrs,
                "sold",
                block.timestamp
            )
        );

        b.stage = Stage.Sold;

        emit Transferred(
            id,
            Stage.Sold,
            retailer,
            bytes32(0)
        );
    }

    // ---------------------------------------------------------------------
    // RISK
    // ---------------------------------------------------------------------

    function setRisk(
        uint id,
        uint score
    )
        external
        onlyRelayer
        live(id)
    {
        require(
            score <= 100,
            "0-100"
        );

        batches[id].risk = score;
        batches[id].flagged = score >= FLAG_AT;

        emit RiskUpdated(
            id,
            score,
            batches[id].flagged
        );
    }

    // ---------------------------------------------------------------------
    // RECALL
    // ---------------------------------------------------------------------

    function recall(
        uint id,
        string calldata reason
    )
        external
        onlyRelayer
        live(id)
    {
        batches[id].recalled = true;
        batches[id].recallReason = reason;

        emit Recalled(
            id,
            reason
        );
    }

    // ---------------------------------------------------------------------
    // READ FUNCTIONS
    // ---------------------------------------------------------------------

    function getBatch(uint id)
        external
        view
        returns (Batch memory)
    {
        return batches[id];
    }

    function getSteps(uint id)
        external
        view
        returns (Step[] memory)
    {
        return steps[id];
    }

    function getHolders(Role r)
        external
        view
        returns (bytes32[] memory)
    {
        return holders[r];
    }
}