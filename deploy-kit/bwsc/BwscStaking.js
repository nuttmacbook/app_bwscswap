function program() {
  /*
   * YOUR CODE (on-chain). BwscStaking: many pools, each "stake X, earn Y", in two phases.
   *
   * Phase 1 — createPool (owner): picks the stake token and the reward token. No reward yet; people may already stake.
   * Phase 2 — addReward (owner, any time, any number of times): "pay `amount` out evenly over the next `duration`
   *           seconds". Each top-up is its own stream with its own rate; streams that overlap add up. Examples:
   *             day 0:  100 USDT over 30 days   → 3.33 USDT/day until day 30
   *             day 15:  50 USDT over 20 days   → +2.5 USDT/day until day 35 (5.83/day from day 15 to 30)
   *             day 40:  40 USDT over 90 days   → 0.44 USDT/day until day 130
   *           The reward is paid in when the stream is added and can NEVER be taken back out by the owner.
   *
   * Every second, the running streams' rate is shared by everyone staked, by stake size (reward-per-share accumulator).
   * Seconds when nobody is staked (and rounding dust) go to `unallocated`: still locked here, never withdrawable;
   * the owner can only stream them out again (restream).
   *
   * Taking stake out (unstake) and claiming always work, even while paused. Paused = no new stakes.
   * Any mix of coins: stake the native coin (0x0…0) or a token, earn the native coin or a token.
 * Every token keeps counters (staked + reward money) that must equal what this program holds; tests check it.
 * Pools are listed by number (poolAt), so there can be very many; getView reads a page of them.
   * Times are seconds (block time / 1000). Amounts are bigint in the token's smallest unit.
 * Init input (deploy-kit/bwsc/inputs/4-BwscStaking.json): { owner, namespace?, description? }
   */
  const ZERO = "0x0000000000000000000000000000000000000000"
  const PRECISION = 1000000000000000000000000000000n   // 1e30: precision even for 18-decimal stakes and 6-decimal rewards
  const MIN_DURATION = 60n                              // a stream lasts at least a minute…
  const MAX_DURATION = 5n * 366n * 86400n               // …and at most about 5 years
  const MAX_STREAMS = 100                               // running streams per pool (keeps every update cheap)

  const ABI = {
    functions: [
      { name: "stake", inputs: [{ name: "pool", type: "string" }, { name: "amount", type: "uint" }], outputs: [{ name: "staked", type: "uint" }], payable: true, description: "Stake in a pool (native coin: send the amount as value)" },
      { name: "unstake", inputs: [{ name: "pool", type: "string" }, { name: "amount", type: "uint" }], outputs: [{ name: "staked", type: "uint" }], payable: true, description: "Take stake out (always works)" },
      { name: "claim", inputs: [{ name: "pool", type: "string" }], outputs: [{ name: "paid", type: "uint" }], payable: true, description: "Receive the rewards earned so far" },
      { name: "createPool", inputs: [{ name: "pool", type: "string" }, { name: "stakeToken", type: "address" }, { name: "rewardToken", type: "address" }], outputs: [], payable: true, description: "Phase 1 (owner): a pool with its stake token and reward token" },
      { name: "addReward", inputs: [{ name: "pool", type: "string" }, { name: "amount", type: "uint" }, { name: "duration", type: "uint" }], outputs: [{ name: "stream", type: "object" }], payable: true, description: "Phase 2 (owner): pay amount out evenly over the next duration seconds; cannot be taken back" },
      { name: "restream", inputs: [{ name: "pool", type: "string" }, { name: "amount", type: "uint" }, { name: "duration", type: "uint" }], outputs: [{ name: "stream", type: "object" }], payable: true, description: "Owner: stream unallocated reward (seconds nobody was staked) out again" },
      { name: "setPaused", inputs: [{ name: "paused", type: "bool" }], outputs: [], payable: true },
      { name: "transferOwnership", inputs: [{ name: "owner", type: "address" }], outputs: [], payable: true },
      { name: "sendOutExtraNative", inputs: [{ name: "wallets", type: "array" }], outputs: [{ name: "each", type: "uint" }], payable: true },
      { name: "pendingOf", inputs: [{ name: "pool", type: "string" }, { name: "account", type: "address" }], outputs: [{ name: "pending", type: "uint" }], readonly: true },
      { name: "stakeOf", inputs: [{ name: "pool", type: "string" }, { name: "account", type: "address" }], outputs: [{ name: "staked", type: "uint" }], readonly: true },
      { name: "getView", inputs: [{ name: "account", type: "address" }, { name: "offset", type: "uint" }, { name: "limit", type: "uint" }], outputs: [{ name: "view", type: "object" }], readonly: true },
    ],
    events: [
      { name: "Staked", fields: [{ name: "pool", type: "string" }, { name: "account", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "staked", type: "uint" }] },
      { name: "Unstaked", fields: [{ name: "pool", type: "string" }, { name: "account", type: "address", indexed: true }, { name: "amount", type: "uint" }, { name: "staked", type: "uint" }] },
      { name: "Claimed", fields: [{ name: "pool", type: "string" }, { name: "account", type: "address", indexed: true }, { name: "amount", type: "uint" }] },
      { name: "PoolCreated", fields: [{ name: "pool", type: "string" }, { name: "stakeToken", type: "address" }, { name: "rewardToken", type: "address" }] },
      { name: "RewardAdded", fields: [{ name: "pool", type: "string" }, { name: "amount", type: "uint" }, { name: "duration", type: "uint" }, { name: "rate", type: "uint" }, { name: "endsAt", type: "uint" }, { name: "fromUnallocated", type: "bool" }] },
      { name: "Paused", fields: [{ name: "paused", type: "bool" }] },
      { name: "OwnershipTransferred", fields: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }] },
      { name: "NativeSentOut", fields: [{ name: "total", type: "uint" }, { name: "each", type: "uint" }] },
    ],
  }

  /* ------------------------------------------------------------------ checks */

  function isAddress(value) {
    return typeof value === "string" && value.length === 42 && value.slice(0, 2) === "0x"
  }
  function requireAddress(value, label) {
    if (!isAddress(value) || value === ZERO) throw new Error(label + " must be an address")
    return value.toLowerCase()
  }
  function requireToken(value, label) {
    if (!isAddress(value)) throw new Error(label + " must be an address (0x0…0 for the native coin)")
    return value.toLowerCase()
  }
  function requireAmount(value, label) {
    if (typeof value !== "bigint" || value < 0n) throw new Error(label + " must be a whole number of at least 0")
    return value
  }
  function requirePoolId(value) {
    // No regular expressions on this chain (their running time is not fixed): check each character
    if (typeof value !== "string" || value.length < 1 || value.length > 40) throw new Error("pool must be 1–40 characters: a-z, 0-9 and -")
    const allowed = "abcdefghijklmnopqrstuvwxyz0123456789-"
    for (let i = 0; i < value.length; i++) {
      if (allowed.indexOf(value.charAt(i)) < 0) throw new Error("pool must be 1–40 characters: a-z, 0-9 and -")
    }
    return value
  }
  function requireDuration(value) {
    if (typeof value !== "bigint" || value < MIN_DURATION || value > MAX_DURATION) throw new Error("duration must be from 1 minute to 5 years (in seconds)")
    return value
  }

  const onlyOwner = (fn) => (params) => {
    if (params.context.sender !== readDB("owner")) throw new Error("Only the owner can do this")
    return fn(params)
  }
  const nonReentrant = (fn) => (params) => {
    if (readDB("locked")) throw new Error("Busy, try again")
    writeDB("locked", true)
    try { return fn(params) } finally { deleteDB("locked") }
  }

  /* ------------------------------------------------------------------ setup */

  function initialization(params) {
    writeDB("owner", requireAddress(params.input.owner, "owner"))
    writeDB("paused", false)
    writeDB("poolCount", 0n)
    setMetadata("abi", ABI)
    if (params.input.namespace) setMetadata("namespace", params.input.namespace)
    if (params.input.description) setMetadata("description", params.input.description)
  }

  function migrate() {
    setMetadata("abi", ABI)
  }

  /* ------------------------------------------------------------------ storage */

  const nowOf = (params) => params.block.timestamp / 1000n
  const poolOf = (id) => {
    const p = readDB(map("pool", id))
    if (!p) throw new Error("No pool named " + id)
    return p
  }
  const userKey = (id, account) => id + "/" + account
  const userOf = (id, account) => readDB(map("user", userKey(id, account))) || { amount: 0n, debt: 0n, owed: 0n }
  const addTo = (name, k, amount) => writeDB(map(name, k), (readDB(map(name, k)) || 0n) + amount)
  // How much rate stops at second `at` (all streams that end then)
  const dropKey = (id, at) => id + "/" + at

  /**
   * The pool as of `now`, computed without writing. Goes through stream ends in order: each piece of time pays the
   * rate that ran then. Returns the changed copy plus the stream ends that passed (to delete).
   */
  function advanced(p0, now) {
    const p = { accPerShare: p0.accPerShare, distributed: p0.distributed, unallocated: p0.unallocated, rate: p0.rate, lastTime: p0.lastTime, ends: p0.ends.slice() }
    const passed = []
    const pay = (until) => {
      if (until <= p.lastTime) return
      const reward = p.rate * (until - p.lastTime)
      if (reward > 0n) {
        if (p0.totalStaked > 0n) {
          p.accPerShare = p.accPerShare + (reward * PRECISION) / p0.totalStaked
          p.distributed = p.distributed + reward
        } else {
          p.unallocated = p.unallocated + reward
        }
      }
      p.lastTime = until
    }
    while (p.ends.length > 0 && p.ends.at(0) <= now) {
      const end = p.ends.at(0)
      pay(end)
      p.rate = p.rate - (readDB(map("drop", dropKey(p0.id, end))) || 0n)
      passed.push(end)
      p.ends = p.ends.slice(1)
    }
    pay(now)
    return { p: p, passed: passed }
  }

  /** Brings a pool up to `now` and returns it (the caller writes it back) */
  function update(p, now) {
    const a = advanced(p, now)
    for (const end of a.passed) deleteDB(map("drop", dropKey(p.id, end)))
    p.accPerShare = a.p.accPerShare
    p.distributed = a.p.distributed
    p.unallocated = a.p.unallocated
    p.rate = a.p.rate
    p.lastTime = a.p.lastTime
    p.ends = a.p.ends
    return p
  }

  /** Moves what the user earned so far into `owed` (before their stake changes) */
  function settle(p, u) {
    u.owed = u.owed + (u.amount * p.accPerShare) / PRECISION - u.debt
    return u
  }

  /* ------------------------------------------------------------------ moving coins */

  // Takes `amount` from the caller and returns what really arrived. The native coin must come as value, exactly.
  function take(params, token, amount) {
    const value = params.value || 0n
    if (token === ZERO) {
      if (value !== amount) throw new Error("Send exactly the amount as value for the native coin")
      return amount
    }
    if (value !== 0n) throw new Error("Do not send native coin with a token")
    const balance = () => runProgram(token, "balanceOf", { who: ThisAddress() }, { readonly: true })
    const before = balance()
    runProgram(token, "transferFrom", { from: params.context.sender, to: ThisAddress(), amount: amount })
    return balance() - before
  }
  function pay(token, to, amount) {
    if (amount === 0n) return
    if (token === ZERO) transferNative(to, amount)
    else runProgram(token, "transfer", { to: to, amount: amount })
  }

  /** Starts a stream of `amount` over `duration` from now; the rounding remainder goes to unallocated */
  function startStream(p, amount, duration, now, fromUnallocated) {
    const rate = amount / duration
    if (rate === 0n) throw new Error("The amount is too small for that many seconds")
    if (p.ends.length >= MAX_STREAMS) throw new Error("Too many streams running in this pool; wait for some to end")
    const endsAt = now + duration
    p.rate = p.rate + rate
    p.unallocated = p.unallocated + (amount - rate * duration)
    addTo("drop", dropKey(p.id, endsAt), rate)
    if (p.ends.indexOf(endsAt) < 0) {
      // keep the list sorted: stream ends are processed in time order
      let at = 0
      while (at < p.ends.length && p.ends.at(at) < endsAt) at++
      p.ends = p.ends.slice(0, at).concat([endsAt]).concat(p.ends.slice(at))
    }
    emit("RewardAdded", { pool: p.id, amount: amount, duration: duration, rate: rate, endsAt: endsAt, fromUnallocated: fromUnallocated })
    return { rate: rate, endsAt: endsAt }
  }

  /* ------------------------------------------------------------------ write: everyone */

  const stake = nonReentrant(function (params) {
    if (readDB("paused")) throw new Error("Staking is paused")
    const id = requirePoolId(params.input.pool)
    const amount = requireAmount(params.input.amount, "amount")
    const who = params.context.sender
    const p = update(poolOf(id), nowOf(params))
    if (amount === 0n) throw new Error("amount must be more than 0")
    const received = take(params, p.stakeToken, amount)
    if (received === 0n) throw new Error("Nothing arrived")
    const u = settle(p, userOf(id, who))
    u.amount = u.amount + received
    u.debt = (u.amount * p.accPerShare) / PRECISION
    p.totalStaked = p.totalStaked + received
    writeDB(map("pool", id), p)
    writeDB(map("user", userKey(id, who)), u)
    addTo("staked", p.stakeToken, received)
    emit("Staked", { pool: id, account: who, amount: received, staked: u.amount }, { indexed: ["account"] })
    return u.amount
  })

  // Always open: paused or not, people can take their stake out
  const unstake = nonReentrant(function (params) {
    const id = requirePoolId(params.input.pool)
    const amount = requireAmount(params.input.amount, "amount")
    const who = params.context.sender
    const p = update(poolOf(id), nowOf(params))
    const u = settle(p, userOf(id, who))
    if (amount === 0n) throw new Error("amount must be more than 0")
    if (amount > u.amount) throw new Error("That is more than you staked")
    u.amount = u.amount - amount
    u.debt = (u.amount * p.accPerShare) / PRECISION
    p.totalStaked = p.totalStaked - amount
    writeDB(map("pool", id), p)
    writeDB(map("user", userKey(id, who)), u)
    addTo("staked", p.stakeToken, 0n - amount)
    emit("Unstaked", { pool: id, account: who, amount: amount, staked: u.amount }, { indexed: ["account"] })
    pay(p.stakeToken, who, amount)
    return u.amount
  })

  // Always open, like unstake
  const claim = nonReentrant(function (params) {
    const id = requirePoolId(params.input.pool)
    const who = params.context.sender
    const p = update(poolOf(id), nowOf(params))
    const u = settle(p, userOf(id, who))
    const amount = u.owed
    if (amount === 0n) throw new Error("No reward to claim yet")
    u.owed = 0n
    u.debt = (u.amount * p.accPerShare) / PRECISION
    p.paid = p.paid + amount
    writeDB(map("pool", id), p)
    writeDB(map("user", userKey(id, who)), u)
    addTo("rewardHeld", p.rewardToken, 0n - amount)
    emit("Claimed", { pool: id, account: who, amount: amount }, { indexed: ["account"] })
    pay(p.rewardToken, who, amount)
    return amount
  })

  /* ------------------------------------------------------------------ write: owner */

  // Phase 1: the pool and its two tokens (fixed for good)
  const createPool = onlyOwner(function (params) {
    const i = params.input
    const id = requirePoolId(i.pool)
    if (readDB(map("pool", id))) throw new Error("A pool named " + id + " already exists")
    const stakeToken = requireToken(i.stakeToken, "stakeToken")
    const rewardToken = requireToken(i.rewardToken, "rewardToken")
    const p = { id: id, stakeToken: stakeToken, rewardToken: rewardToken, createdAt: nowOf(params),
      totalStaked: 0n, accPerShare: 0n, lastTime: nowOf(params), rate: 0n, ends: [],
      funded: 0n, distributed: 0n, unallocated: 0n, paid: 0n, streams: 0n }
    writeDB(map("pool", id), p)
    // Listed by number, so a long list never has to be read whole
    const count = readDB("poolCount") || 0n
    writeDB(map("poolAt", count), id)
    writeDB("poolCount", count + 1n)
    emit("PoolCreated", { pool: id, stakeToken: stakeToken, rewardToken: rewardToken })
  })

  // Phase 2: pay `amount` in now and stream it out over the next `duration` seconds (never withdrawable)
  const addReward = onlyOwner(nonReentrant(function (params) {
    const id = requirePoolId(params.input.pool)
    const amount = requireAmount(params.input.amount, "amount")
    const duration = requireDuration(params.input.duration)
    const now = nowOf(params)
    const p = update(poolOf(id), now)
    if (amount === 0n) throw new Error("amount must be more than 0")
    const received = take(params, p.rewardToken, amount)
    p.funded = p.funded + received
    p.streams = p.streams + 1n
    const stream = startStream(p, received, duration, now, false)
    writeDB(map("pool", id), p)
    addTo("rewardHeld", p.rewardToken, received)
    return stream
  }))

  // Reward of the seconds nobody was staked: still locked here; the owner can only stream it out again
  const restream = onlyOwner(nonReentrant(function (params) {
    const id = requirePoolId(params.input.pool)
    const amount = requireAmount(params.input.amount, "amount")
    const duration = requireDuration(params.input.duration)
    const now = nowOf(params)
    const p = update(poolOf(id), now)
    if (amount === 0n) throw new Error("amount must be more than 0")
    if (amount > p.unallocated) throw new Error("More than the unallocated reward")
    p.unallocated = p.unallocated - amount
    p.streams = p.streams + 1n
    const stream = startStream(p, amount, duration, now, true)
    writeDB(map("pool", id), p)
    return stream
  }))

  const setPaused = onlyOwner(function (params) {
    const paused = params.input.paused === true
    writeDB("paused", paused)
    emit("Paused", { paused: paused })
  })

  const transferOwnership = onlyOwner(function (params) {
    const next = requireAddress(params.input.owner, "owner")
    emit("OwnershipTransferred", { from: readDB("owner"), to: next }, { indexed: ["from", "to"] })
    writeDB("owner", next)
  })

  // Native coin that is neither a stake nor a reward (sent with other calls by mistake)
  const sendOutExtraNative = onlyOwner(function (params) {
    const wallets = params.input.wallets
    if (!Array.isArray(wallets) || wallets.length === 0) throw new Error("wallets must be a list of addresses")
    for (const wallet of wallets) requireAddress(wallet, "wallet")
    const extra = ThisBalance() - (readDB(map("staked", ZERO)) || 0n) - (readDB(map("rewardHeld", ZERO)) || 0n)
    const each = extra > 0n ? extra / BigInt(wallets.length) : 0n
    if (each === 0n) throw new Error("Nothing to send out")
    for (const wallet of wallets) transferNative(wallet, each)
    emit("NativeSentOut", { total: extra, each: each })
    return each
  })

  /* ------------------------------------------------------------------ read */

  function pendingNow(p, u, now) {
    const a = advanced(p, now).p
    return u.owed + (u.amount * a.accPerShare) / PRECISION - u.debt
  }

  function pendingOf(params) {
    const id = requirePoolId(params.input.pool)
    return pendingNow(poolOf(id), userOf(id, String(params.input.account).toLowerCase()), nowOf(params))
  }

  function stakeOf(params) {
    return userOf(requirePoolId(params.input.pool), String(params.input.account).toLowerCase()).amount
  }

  function tokenInfo(token, account) {
    const isNative = token === ZERO
    const read = (fn, input, fallback) => { try { return runProgram(token, fn, input, { readonly: true }) } catch (e) { return fallback } }
    const mine = isAddress(account) && account !== ZERO
    return {
      address: token,
      isNative: isNative,
      symbol: isNative ? "" : read("ticker", {}, ""),
      decimals: isNative ? 18n : read("decimals", {}, 0n),
      held: isNative ? ThisBalance() : read("balanceOf", { who: ThisAddress() }, 0n),
      balance: mine ? (isNative ? BalanceOf(account) : read("balanceOf", { who: account }, 0n)) : 0n,
      allowance: mine && !isNative ? read("allowance", { owner: account, spender: ThisAddress() }, 0n) : 0n,
    }
  }

  // Everything the stake page needs in one call: pools offset … offset + limit (limit ≤ 100), each token read once
  function getView(params) {
    const account = isAddress(params.input.account) ? params.input.account.toLowerCase() : ""
    const now = nowOf(params)
    const count = readDB("poolCount") || 0n
    const offset = typeof params.input.offset === "bigint" && params.input.offset > 0n ? params.input.offset : 0n
    const want = typeof params.input.limit === "bigint" && params.input.limit > 0n ? params.input.limit : 100n
    const ids = []
    for (let n = offset; n < count && n < offset + (want > 100n ? 100n : want); n++) ids.push(readDB(map("poolAt", n)))
    const infos = []
    const infoOf = (token) => {
      const known = infos.find((x) => x.address === token)
      if (known) return known
      const info = tokenInfo(token, account)
      infos.push(info)
      return info
    }
    return {
      staking: ThisAddress(),
      owner: readDB("owner"),
      paused: readDB("paused") === true,
      now: now,
      poolCount: count,
      offset: offset,
      maxStreams: BigInt(MAX_STREAMS),
      pools: ids.map((id) => {
        const raw = poolOf(id)
        const p = advanced(raw, now).p
        const u = account ? userOf(id, account) : { amount: 0n, debt: 0n, owed: 0n }
        // Reward still to come from the running streams (seconds left × each stream's rate)
        let scheduled = 0n
        let rate = p.rate
        let from = now
        for (const end of p.ends) {
          scheduled = scheduled + rate * (end - from)
          rate = rate - (readDB(map("drop", dropKey(id, end))) || 0n)
          from = end
        }
        return {
          id: id,
          stake: infoOf(raw.stakeToken),
          reward: infoOf(raw.rewardToken),
          status: p.rate > 0n ? "live" : raw.funded === 0n ? "new" : "idle",
          rewardPerSecond: p.rate,
          nextChangeAt: p.ends.length > 0 ? p.ends.at(0) : 0n,
          rewardEndsAt: p.ends.length > 0 ? p.ends.at(-1) : 0n,
          scheduled: scheduled,
          funded: raw.funded,
          distributed: p.distributed,
          unallocated: p.unallocated,
          paid: raw.paid,
          streams: raw.streams,
          totalStaked: raw.totalStaked,
          lastUpdate: raw.lastTime,
          myStake: u.amount,
          myPending: account ? pendingNow(raw, u, now) : 0n,
        }
      }),
      // Per token of these pools: counted stakes + reward money, and what the program really holds (they must match)
      counters: infos.map((info) => ({ token: info.address, staked: readDB(map("staked", info.address)) || 0n, rewardHeld: readDB(map("rewardHeld", info.address)) || 0n, held: info.held })),
    }
  }

  return { stake, unstake, claim, createPool, addReward, restream, setPaused, transferOwnership, sendOutExtraNative, pendingOf, stakeOf, getView }
}
