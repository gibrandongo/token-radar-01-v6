/* Farm-plan templates for the token launch radar.
 * Shared by main.ts (which renders board.json) and the dashboard page
 * (which renders the detail view), so the two always agree byte for byte.
 * Pure data and pure functions: no DOM, no network, no dates. */
var RadarSteps = (function () {
  'use strict';

  /* Category group for each snapshot category. Anything unlisted is 'other'. */
  var GROUPS = {
    'Dexs': 'dex',
    'Lending': 'lending', 'Uncollateralized Lending': 'lending',
    'Collateral Markets': 'lending',
    'Yield': 'yield', 'Yield Aggregator': 'yield', 'Farm': 'yield',
    'Leveraged Farming': 'yield',
    'Derivatives': 'derivatives', 'Interest Rate Derivatives': 'derivatives',
    'Options': 'derivatives', 'Prediction Market': 'derivatives',
    'RWA': 'rwa',
    'Risk Curators': 'curator',
    'Onchain Capital Allocator': 'allocator',
    'CDP': 'stablecoin', 'CDP Manager': 'stablecoin',
    'Dual-Token Stablecoin': 'stablecoin', 'Stablecoin Wrapper': 'stablecoin',
    'Basis Trading': 'basis',
    'Chain': 'chain',
    'Staking Pool': 'staking', 'Restaking': 'staking',
    'Anchor BTC': 'staking', 'Decentralized BTC': 'staking',
    'Liquidity Manager': 'liquidity', 'Liquidity Management': 'liquidity'
  };

  /* Gas-cost wording per chain, filled into the {gas} slot. */
  var CHEAP_L2 = 'about $0.10-$1 of gas per transaction';
  var GAS = {
    'Ethereum': 'about $8-$25 of gas per transaction',
    'Solana': 'under $0.05 of fees per transaction',
    'Binance': 'about $0.10-$0.50 of gas per transaction',
    'Bitcoin': 'about $1-$5 of network fees per transaction',
    'Base': CHEAP_L2, 'Arbitrum': CHEAP_L2, 'Optimism': CHEAP_L2,
    'Unichain': CHEAP_L2, 'Ink': CHEAP_L2, 'Linea': CHEAP_L2,
    'Mantle': CHEAP_L2, 'Polygon': CHEAP_L2, 'Katana': CHEAP_L2,
    'Abstract': CHEAP_L2, 'Soneium': CHEAP_L2, 'World Chain': CHEAP_L2
  };
  var GAS_DEFAULT = 'about $0.05-$1 of gas per transaction';

  /* Starter position size, tiered by the protocol's own TVL. */
  function sizeFor(tvl) {
    if (tvl < 10000000) return '$250-$500';
    if (tvl < 50000000) return '$500-$1,000';
    return '$1,000-$2,500';
  }

  var SETUP = 'Open {name} on {chain}: connect a wallet you control, verify the ' +
    'contract address against the protocol\'s official docs, and keep a small ' +
    'gas balance ready. Cost: {gas} for approvals. Time: 10 minutes.';
  var REVIEW = 'Review the position weekly on {name}\'s dashboard: track TVL, ' +
    'your share, and any points or rewards accrued, and log gas spent against ' +
    'rewards earned. Cost: none. Time: 15 minutes a week.';

  /* Three group-specific steps each. Every step states a cost and a time. */
  var PLANS = {
    dex: [
      'Provide {size} of liquidity to the highest-volume {name} pool on {chain}, ' +
      'in the pair the pool already prices deepest. Cost: {gas}. Time: 20 minutes.',
      'Stake the LP receipt in {name}\'s rewards gauge or farm contract if one is ' +
      'live, so the position earns fees plus incentives. Cost: {gas}. Time: 10 minutes.',
      'Set a range rule before you deposit: decide the price band and the exit ' +
      'trigger, and check impermanent loss weekly against simply holding. ' +
      'Cost: none. Time: 15 minutes.'
    ],
    lending: [
      'Supply {size} in a stablecoin to {name}\'s lending pool on {chain}; start ' +
      'with the market with the deepest liquidity and the lowest utilisation. ' +
      'Cost: {gas}. Time: 20 minutes.',
      'Borrow only against the supply if you need leverage: keep the loan-to-value ' +
      'under half the liquidation threshold and set a price alert. ' +
      'Cost: {gas} per borrow. Time: 15 minutes.',
      'Claim or compound supply incentives weekly, and check the pool\'s utilisation ' +
      'and borrow rate before adding more. Cost: {gas} per claim. Time: 10 minutes a week.'
    ],
    yield: [
      'Deposit {size} into {name}\'s highest-TVL yield vault on {chain}; read the ' +
      'vault\'s strategy note first so you know where the yield comes from. ' +
      'Cost: {gas}. Time: 20 minutes.',
      'Check the vault\'s fee schedule and withdrawal window before depositing, and ' +
      'confirm whether rewards vest or lock. Cost: none. Time: 10 minutes.',
      'Harvest or restake rewards on a fixed weekly schedule instead of reacting to ' +
      'APY headlines; compare net yield after gas. Cost: {gas} per harvest. ' +
      'Time: 10 minutes a week.'
    ],
    derivatives: [
      'Open a small {size} hedged position on {name} on {chain} - for example a ' +
      'delta-neutral or basis position - sized so a 20% adverse move cannot ' +
      'liquidate you. Cost: {gas} plus funding. Time: 30 minutes.',
      'Set stop and take-profit levels at entry and write down the funding-rate ' +
      'level at which you exit. Cost: none. Time: 10 minutes.',
      'Monitor open interest and funding daily for the first week; close the ' +
      'position if funding turns against you for three days running. ' +
      'Cost: {gas} to close. Time: 10 minutes a day.'
    ],
    rwa: [
      'Complete {name}\'s onboarding and identity checks for its tokenised product ' +
      'on {chain}, and confirm the custodian and redemption terms in writing. ' +
      'Cost: none. Time: 1-3 days for approval.',
      'Subscribe {size} to the product\'s primary offering or buy the token on its ' +
      'secondary venue, and record the redemption window and any lock-up. ' +
      'Cost: {gas} plus any subscription fee. Time: 30 minutes.',
      'Track the underlying asset\'s attestations monthly and check that redemptions ' +
      'are still settling inside their stated window. Cost: none. ' +
      'Time: 20 minutes a month.'
    ],
    curator: [
      'Deposit {size} into the {name} vault on {chain} whose curator and risk ' +
      'parameters you have read; prefer the vault with the longest track record. ' +
      'Cost: {gas}. Time: 20 minutes.',
      'Read the vault\'s allocation caps and the curator\'s rebalancing policy, and ' +
      'check which underlying protocols it routes to. Cost: none. Time: 20 minutes.',
      'Follow the curator\'s rebalances and compare the vault\'s realised yield ' +
      'against its stated target each month; exit if it misses two months running. ' +
      'Cost: {gas} to exit. Time: 15 minutes a month.'
    ],
    allocator: [
      'Allocate {size} through {name} on {chain} to the strategy whose mandate ' +
      'matches your risk tolerance, and note the management and performance fees. ' +
      'Cost: {gas}. Time: 20 minutes.',
      'Check the allocator\'s rebalancing cadence and the withdrawal delay, and ' +
      'confirm how much of the allocation sits in each underlying venue. ' +
      'Cost: none. Time: 15 minutes.',
      'Review the strategy\'s net-of-fee return monthly against a plain stablecoin ' +
      'yield; move the allocation if it trails for two months. Cost: {gas} to move. ' +
      'Time: 15 minutes a month.'
    ],
    stablecoin: [
      'Mint {size} of {name}\'s stable asset on {chain} against over-collateralised ' +
      'collateral, keeping the collateral ratio at least 1.5x the minimum. ' +
      'Cost: {gas}. Time: 25 minutes.',
      'Set a collateral-price alert well above the liquidation level and keep ' +
      'reserve collateral ready to top up. Cost: none. Time: 10 minutes.',
      'Repay or rebalance when the collateral ratio drifts toward the minimum, and ' +
      'check the stability fee weekly. Cost: {gas} per adjustment. Time: 10 minutes a week.'
    ],
    basis: [
      'Open a {size} basis position through {name} on {chain}: long spot, short ' +
      'the matching perpetual, sized so funding stays positive after fees. ' +
      'Cost: {gas} plus funding. Time: 30 minutes.',
      'Record the entry basis and the funding rate; define the exit trigger if the ' +
      'annualised basis falls below your hurdle. Cost: none. Time: 10 minutes.',
      'Rebalance the hedge daily while the position is open and close both legs ' +
      'together to avoid naked exposure. Cost: {gas} per rebalance. ' +
      'Time: 10 minutes a day.'
    ],
    chain: [
      'Bridge {size} to {name} using the chain\'s official bridge, and keep gas ' +
      'tokens for at least ten transactions. Cost: {gas} plus bridge fee. Time: 20 minutes.',
      'Use the chain\'s core apps - its DEX and lending market - with small positions ' +
      'first to learn gas costs and confirmation times. Cost: {gas} per transaction. ' +
      'Time: 30 minutes.',
      'Track the chain\'s TVL and daily active addresses weekly; scale the position ' +
      'only while both are rising. Cost: none. Time: 15 minutes a week.'
    ],
    staking: [
      'Stake {size} through {name} on {chain}, choosing the validator or pool with ' +
      'the longest uptime record and no recent slashing. Cost: {gas}. Time: 20 minutes.',
      'Confirm the unbonding period and whether rewards auto-compound or must be ' +
      'claimed, and calendar the unlock date. Cost: none. Time: 10 minutes.',
      'Claim and restake rewards on the protocol\'s epoch schedule, and re-check ' +
      'validator performance monthly. Cost: {gas} per claim. Time: 10 minutes a month.'
    ],
    liquidity: [
      'Deposit {size} into {name}\'s managed liquidity position on {chain} and read ' +
      'the manager\'s rebalancing rules before committing. Cost: {gas}. Time: 20 minutes.',
      'Check the manager\'s fee tier and rebalance frequency, and confirm how it ' +
      'handles out-of-range positions. Cost: none. Time: 15 minutes.',
      'Compare the managed position\'s net return against a manual position monthly, ' +
      'accounting for manager fees. Cost: none. Time: 15 minutes a month.'
    ],
    other: [
      'Start with {size} on {name} on {chain}: use the protocol\'s main product ' +
      'once with a small amount to learn its flows, fees and timing. ' +
      'Cost: {gas}. Time: 30 minutes.',
      'Read the protocol\'s docs for risks, fees, withdrawal windows and any points ' +
      'programme, and note what is unaudited. Cost: none. Time: 20 minutes.',
      'Scale only after the first full cycle (deposit, use, withdraw) completes ' +
      'cleanly, and keep records of every transaction. Cost: {gas} per transaction. ' +
      'Time: 15 minutes.'
    ]
  };

  function fill(template, vars) {
    return template.replace(/\{(\w+)\}/g, function (_, key) { return vars[key]; });
  }

  /* Render the 5 farm steps for one board row. Row: {name, category, chains, tvl}. */
  function renderSteps(row) {
    var chain = (row.chains && row.chains.length) ? row.chains[0] : 'its home chain';
    var vars = {
      name: row.name,
      chain: chain,
      size: sizeFor(row.tvl),
      gas: GAS[chain] || GAS_DEFAULT
    };
    var group = GROUPS[row.category] || 'other';
    var steps = [SETUP].concat(PLANS[group]).concat([REVIEW]);
    return steps.map(function (t) { return fill(t, vars); });
  }

  return { renderSteps: renderSteps, groupOf: function (c) { return GROUPS[c] || 'other'; } };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = RadarSteps; }
