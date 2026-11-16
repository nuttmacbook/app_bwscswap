function program() {
  function initialization(params) {
    const owner = params.context.sender
    writeDB("name", params.input.name)
    writeDB("ticker", params.input.ticker)
    writeDB("decimals", params.input.decimals)
    writeDB("totalSupply", params.input.supply)
    writeDB("owner", owner)
    writeDB(map("balances", owner), params.input.supply)
    if (params.input.namespace) setMetadata("namespace", params.input.namespace)
    // Program metadata can only be set by code: icon / url / contact / description may be sent at deploy time
    if (params.input.icon) setMetadata("icon", params.input.icon)
    if (params.input.url) setMetadata("url", params.input.url)
    if (params.input.contact) setMetadata("contact", params.input.contact)
    if (params.input.description) setMetadata("description", params.input.description)
    emit("Transfer", { from: "0x0000000000000000000000000000000000000000", to: owner, amount: params.input.supply }, { indexed: ["from", "to"] })
  }

  function name() { return readDB("name") }
  function ticker() { return readDB("ticker") }
  function decimals() { return readDB("decimals") }
  function totalSupply() { return readDB("totalSupply") }
  function balanceOf(params) { return readDB(map("balances", params.input.who)) || 0n }
  function allowance(params) { return readDB(map("allowance", params.input.owner, params.input.spender)) || 0n }

  function move(from, to, amount) {
    if (amount <= 0n) throw new Error("amount must be greater than 0")
    const balance = readDB(map("balances", from)) || 0n
    if (balance < amount) throw new Error("insufficient balance")
    writeDB(map("balances", from), balance - amount)
    writeDB(map("balances", to), (readDB(map("balances", to)) || 0n) + amount)
    emit("Transfer", { from: from, to: to, amount: amount }, { indexed: ["from", "to"] })
  }

  function transfer(params) {
    move(params.context.sender, params.input.to, params.input.amount)
    return true
  }

  function multiTransfer(params) {
    let count = 0n
    for (const item of params.input.transfers) {
      move(params.context.sender, item.to, item.amount)
      count = count + 1n
    }
    if (count === 0n) throw new Error("no transfers")
    return count
  }

  function setAllowance(owner, spender, amount) {
    writeDB(map("allowance", owner, spender), amount)
    emit("Approval", { owner: owner, spender: spender, amount: amount }, { indexed: ["owner", "spender"] })
  }

  function approve(params) {
    setAllowance(params.context.sender, params.input.spender, params.input.amount)
    return true
  }

  function isValidSignatureNow(signer, hash, signature) {
    if (typeof signer !== "string" || typeof hash !== "string" || typeof signature !== "string") return false
    try {
      if (IsProgram(signer)) {
        const reply = runProgram(signer, "isValidSignature", { hash: hash, signature: signature }, { readonly: true })
        return reply === "0x1626ba7e"
      }
      return ecrecoverDigest(hash, signature) === signer.toLowerCase()
    } catch (e) {
      return false
    }
  }

  function permitDomain() {
    return { name: readDB("name"), version: "1", chainId: ChainId(), verifyingContract: ThisAddress() }
  }
  function DOMAIN_SEPARATOR() { return eip712DomainSeparator(permitDomain()) }
  function nonces(params) { return readDB(map("nonces", params.input.owner)) || 0n }

  // ERC-2612 · Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)
  const PERMIT_TYPES = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }

  function permit(params) {
    const owner = params.input.owner
    const spender = params.input.spender
    const value = params.input.value
    const deadline = params.input.deadline
    if (typeof owner !== "string" || typeof spender !== "string" || owner.length !== 42 || spender.length !== 42) {
      throw new Error("owner and spender must be addresses")
    }
    if (typeof value !== "bigint" || value < 0n) throw new Error("value must be a non-negative bigint")
    if (typeof deadline !== "bigint") throw new Error("deadline must be a bigint (unix seconds, like EIP-2612)")
    if (params.block.timestamp / 1000n > deadline) throw new Error("permit expired")
    const nonce = readDB(map("nonces", owner)) || 0n
    const digest = eip712Digest(permitDomain(), PERMIT_TYPES, "Permit",
      { owner: owner, spender: spender, value: value, nonce: nonce, deadline: deadline })
    if (!isValidSignatureNow(owner, digest, params.input.signature)) throw new Error("invalid permit signature")
    writeDB(map("nonces", owner), nonce + 1n)
    setAllowance(owner, spender, value)
    return true
  }

  function transferFrom(params) {
    const spender = params.context.sender
    const allowed = readDB(map("allowance", params.input.from, spender)) || 0n
    if (allowed < params.input.amount) throw new Error("insufficient allowance")
    writeDB(map("allowance", params.input.from, spender), allowed - params.input.amount)
    move(params.input.from, params.input.to, params.input.amount)
    return true
  }

  return { name, ticker, decimals, totalSupply, balanceOf, allowance, transfer, multiTransfer, approve, transferFrom,
    permit, nonces, permitDomain, DOMAIN_SEPARATOR }
}
