/*
 * The node writes its own errors in Thai (programs write theirs in whatever language they like).
 * Pages are for everyone, so the common node errors get a plain English sentence here.
 * Unknown text is returned unchanged; a program's own message never matches these patterns. Any other node message in
 * Thai becomes a plain English sentence, so a page never shows Thai. (Thai letters are written as \u codes here.)
 */

const THAI = /[\u0E00-\u0E7F]/;

const NODE_MESSAGES = [
    [ /\u0E22\u0E2D\u0E14 native \u0E02\u0E2D\u0E07 .* \u0E44\u0E21\u0E48\u0E1E\u0E2D/, () => "Not enough coins in your wallet to pay for gas." ],
    [ /\u0E41\u0E01\u0E4A\u0E2A\u0E44\u0E21\u0E48\u0E1E\u0E2D/, () => "The transaction ran out of gas. Try again with a higher gas limit." ],
    [ /nonce (\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07|\u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19)/, () => "Your wallet's transactions arrived out of order. Wait a few seconds and try again." ],
    [ /\u0E25\u0E32\u0E22\u0E40\u0E0B\u0E47\u0E19\u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A from/, () => "Your wallet signed with a different account than the one connected. Reconnect the wallet and try again." ],
    [ /signature \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19 hex|\u0E25\u0E32\u0E22\u0E40\u0E0B\u0E47\u0E19/, () => "The wallet's signature could not be checked. Try again or use another wallet." ],
    [ /\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E17\u0E18\u0E34\u0E4C init/, () => "Only an admin of the chain can approve new programs." ],
    [ /\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E48 upgrader/, () => "Only the program's upgrader can send new code." ],
    [ /\u0E2D\u0E31\u0E1B\u0E40\u0E01\u0E23\u0E14\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \(\u0E44\u0E21\u0E48\u0E21\u0E35 upgrader\)/, () => "This program cannot be changed (it has no upgrader)." ],
    [ /maxFeePerGas .* \u0E15\u0E48\u0E33\u0E01\u0E27\u0E48\u0E32 base fee|\u0E23\u0E32\u0E04\u0E32\u0E41\u0E01\u0E4A\u0E2A\u0E15\u0E48\u0E33\u0E40\u0E01\u0E34\u0E19\u0E44\u0E1B/, () => "The network fee went up while you were signing. Try again." ],
    [ /\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E17\u0E33\u0E07\u0E32\u0E19\u0E40\u0E01\u0E34\u0E19\u0E40\u0E27\u0E25\u0E32/, () => "The program took too long to run." ],
    [ /\u0E43\u0E0A\u0E49\u0E2B\u0E19\u0E48\u0E27\u0E22\u0E04\u0E27\u0E32\u0E21\u0E08\u0E33\u0E40\u0E01\u0E34\u0E19\u0E01\u0E33\u0E2B\u0E19\u0E14/, () => "The program used too much memory." ],
    [ /\u0E40\u0E23\u0E35\u0E22\u0E01 '([^']+)' \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49/, (m) => `This program has no function ${m[1]}.` ],
    [ /\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21/, () => "There is no running program at this address on this network." ],
    [ /namespace '([^']+)' \u0E16\u0E39\u0E01\u0E43\u0E0A\u0E49/, (m) => `The name ${m[1]} is already taken on this chain.` ],
    [ /\u0E2A\u0E48\u0E07\u0E16\u0E35\u0E48\u0E40\u0E01\u0E34\u0E19\u0E01\u0E33\u0E2B\u0E19\u0E14/, () => "Too many transactions from this wallet in a short time. Wait a minute and try again." ],
    [ /\u0E04\u0E34\u0E27\u0E02\u0E2D\u0E07 address \u0E19\u0E35\u0E49\u0E40\u0E15\u0E47\u0E21|\u0E04\u0E34\u0E27\u0E40\u0E15\u0E47\u0E21/, () => "The network is busy. Try again in a moment." ],
    [ /\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u0E2A\u0E33\u0E23\u0E2D\u0E07/, () => "This node only reads. Send transactions to the main node." ],
    [ /\u0E42\u0E04\u0E49\u0E14\u0E44\u0E21\u0E48\u0E1C\u0E48\u0E32\u0E19\u0E01\u0E32\u0E23\u0E15\u0E23\u0E27\u0E08/, () => "The program code did not pass the node's code check." ],
];

/** Plain English for a node message; anything else comes back as it was */
export function nodeMessage(text) {
    const value = String(text ?? "");
    for (const [ pattern, render ] of NODE_MESSAGES) {
        const match = value.match(pattern);
        if (match) return render(match);
    }
    if (THAI.test(value)) return "The network refused this request. Check the details and try again.";
    return value;
}
