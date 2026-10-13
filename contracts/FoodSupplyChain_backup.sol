// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Farm2Fork: immutable farm-to-consumer record, role-based, with ML risk flags and regulator recall.
contract FoodSupplyChain {
    enum Role { None, Farmer, Processor, Distributor, Retailer, Consumer, Regulator }
    enum Stage { Farm, Processing, Distribution, Retail, Sold }

    struct Batch {
        uint id; string commodity; string product; uint quantity; string origin;
        address owner; Stage stage; bool isProduct; bool consumed; uint[] parents;
        uint labScore; string reportCid; uint risk; bool flagged; bool recalled;
        string recallReason; uint createdAt;
    }
    struct Step { Stage stage; address by; address to; int tempDev; uint hrs; string note; uint ts; }

    uint public count;
    uint public constant FLAG_AT = 60;               // ML risk score (0-100) that auto-flags a batch
    mapping(address => Role) public roles;
    mapping(address => uint) public reputation;      // handler reputation 0-100 (ML feature)
    mapping(Role => address[]) private holders;
    mapping(uint => Batch) private batches;
    mapping(uint => Step[]) private steps;

    event RoleAssigned(address indexed account, Role role);
    event BatchRegistered(uint indexed id, string commodity, address indexed farmer);
    event ProductCreated(uint indexed id, string product, uint[] parents);
    event Transferred(uint indexed id, Stage stage, address indexed from, address indexed to);
    event RiskUpdated(uint indexed id, uint risk, bool flagged);
    event Recalled(uint indexed id, string reason);

    modifier only(Role r) { require(roles[msg.sender] == r, "Not authorised"); _; }
    modifier live(uint id) {
        require(id > 0 && id <= count, "No such batch");
        require(!batches[id].recalled, "Batch recalled");
        _;
    }

    constructor() {                                   // deployer is the Regulator (FSSAI-style authority)
        roles[msg.sender] = Role.Regulator;
        holders[Role.Regulator].push(msg.sender);
        reputation[msg.sender] = 100;
    }

    function assignRole(address a, Role r, uint rep) external only(Role.Regulator) {
        require(roles[a] == Role.None && r != Role.None && rep <= 100, "Invalid assignment");
        roles[a] = r; reputation[a] = rep; holders[r].push(a);
        emit RoleAssigned(a, r);
    }
    function setReputation(address a, uint rep) external only(Role.Regulator) {
        require(rep <= 100, "0-100"); reputation[a] = rep;
    }

    function registerBatch(string memory commodity, uint qty, string memory origin, uint labScore, string memory cid)
        external only(Role.Farmer) returns (uint id)
    {
        id = ++count;
        Batch storage b = batches[id];
        b.id = id; b.commodity = commodity; b.product = commodity; b.quantity = qty; b.origin = origin;
        b.owner = msg.sender; b.labScore = labScore; b.reportCid = cid; b.createdAt = block.timestamp;
        emit BatchRegistered(id, commodity, msg.sender);
    }

    /// Processor turns received raw batches into a new product batch (many raw -> one product).
    function processBatch(uint[] memory ins, string memory product, uint qty, uint labScore, string memory cid)
        external only(Role.Processor) returns (uint id)
    {
        require(ins.length > 0, "No inputs");
        id = ++count;
        Batch storage b = batches[id];
        for (uint i = 0; i < ins.length; i++) {
            Batch storage r = batches[ins[i]];
            require(r.owner == msg.sender && r.stage == Stage.Processing && !r.isProduct && !r.consumed && !r.recalled, "Bad input");
            r.consumed = true; b.parents.push(ins[i]);
        }
        b.id = id; b.commodity = batches[ins[0]].commodity; b.product = product; b.quantity = qty;
        b.origin = "Processing unit"; b.owner = msg.sender; b.stage = Stage.Processing; b.isProduct = true;
        b.labScore = labScore; b.reportCid = cid; b.createdAt = block.timestamp;
        emit ProductCreated(id, product, b.parents);
    }

    /// Hand a batch to the next role in the chain, logging temperature deviation (C) and duration (hours).
    function transfer(uint id, address to, int tempDev, uint hrs, string calldata note) external live(id) {
        Batch storage b = batches[id];
        Stage s = b.stage;
        require(b.owner == msg.sender && !b.consumed, "Not owner");
        require(uint(s) < 3, "Cannot transfer further");
        require(s == Stage.Farm || b.isProduct, "Raw batch must be processed");
        require(uint(roles[msg.sender]) == uint(s) + 1, "Wrong sender role");
        require(roles[to] == Role(uint(s) + 2), "Recipient has wrong role");
        steps[id].push(Step(s, msg.sender, to, tempDev, hrs, note, block.timestamp));
        b.owner = to; b.stage = Stage(uint(s) + 1);
        emit Transferred(id, b.stage, msg.sender, to);
    }

    function sell(uint id, int tempDev, uint hrs) external only(Role.Retailer) live(id) {
        Batch storage b = batches[id];
        require(b.owner == msg.sender && b.stage == Stage.Retail, "Not sellable");
        steps[id].push(Step(Stage.Retail, msg.sender, address(0), tempDev, hrs, "sold", block.timestamp));
        b.stage = Stage.Sold;
        emit Transferred(id, Stage.Sold, msg.sender, address(0));
    }

    /// Commit the ML risk score on-chain; scores >= FLAG_AT flag the batch.
    function setRisk(uint id, uint score) external only(Role.Regulator) {
        require(id > 0 && id <= count && score <= 100, "Invalid");
        batches[id].risk = score; batches[id].flagged = score >= FLAG_AT;
        emit RiskUpdated(id, score, batches[id].flagged);
    }
    function recall(uint id, string calldata reason) external only(Role.Regulator) {
        require(id > 0 && id <= count, "No such batch");
        batches[id].recalled = true; batches[id].flagged = true; batches[id].recallReason = reason;
        emit Recalled(id, reason);
    }

    function getBatch(uint id) external view returns (Batch memory) { return batches[id]; }
    function getSteps(uint id) external view returns (Step[] memory) { return steps[id]; }
    function getHolders(Role r) external view returns (address[] memory) { return holders[r]; }
}
