# Research data conventions

[User guide](usage.md) · [Price comparisons](price-comparisons.md) · [Economic statistics](economics-reference.md) · [Market valuation](valuation-reference.md)

This reference describes how the terminal calculates and labels research data. Pane bodies show the data and current failures; recurring methodology belongs here. Headless reports and shared chart metadata retain source details and limitations.

Instrument search keeps broker contract definitions distinct when an underlying symbol represents several expiries, strikes or deliverables. A contract selected from search is retained in that research pane, its followers and saved layout; opening another contract does not reorder the shared ticker's broker definitions. Symbol-only lookups that match several saved contracts require a search selection. Contract-specific prices must come from that contract's data context, rather than the app's symbol-only cache. Broker contract panes and charts are retained in local layouts and exports; public symbol-only sharing is unavailable for them because a recipient's market source cannot be assumed to identify the same contract or broker account.

An explicitly selected public listing remains public even when the saved symbol also has broker contracts. The pane retains the selected result's name, venue, currency and instrument type separately from the shared ticker record. Public research shares identify the selected venue in the symbol; the recipient resolves public market data for that listing. A local layout can retain broker routing context, while a public URL does not carry it.

A quote needs a finite, positive observation timestamp that is no later than the current clock. Missing, invalid or future source times cannot establish a current price, chart update or quote-derived valuation. Receipt time does not replace source time. Retained observations keep their values and existing stale/error status until valid data arrives; historical statement-price observations remain separate.

Earnings estimates, corporate actions, analyst research and historical prices retain the last successful response when a refresh fails, with the failure shown in the footer. A failed refresh does not advance the retrieval time. Changing the ticker, venue or request range clears the previous response; explicit account or access rejection clears denied research. A successful empty response also replaces old data.

## Charts, comparisons, and correlations

Bond history currently has no source-declared price convention. Charts retain its raw observations with unknown price units and do not append a current bond quote: that quote's per-unit or percent-of-par declaration does not establish the basis of a separate historical series. Overview price returns also use the historical observations without appending that quote. A numeric ratio between a quote and an old close cannot establish compatible units. Historical values and current source quotes remain separate; this does not add bond historical coverage or reconstruct yield.

Local chart snapshots retain the full selected instrument with its captured quote and history, including multiple contracts that share one public symbol. Reconstruction uses only observations captured for that exact contract; older public-symbol snapshots remain usable for public listings. A missing contract capture may be loaded from the corresponding market source, but another contract’s capture does not supply it.

Historical price charts retain explicit listing currency and instrument type independently of a current quote. A rejected stale quote can supply those static facts, with its original source timestamp and stale flag in exported `quoteMetadata`; it cannot add a price observation or daily change. Snapshot reloads retain those facts without a live lookup. When optional enrichment supplies a missing field, `fieldSources` preserves that field's separate provenance. Missing or mismatched metadata remains unknown; no currency, FX conversion, or share/contract basis is inferred from a price's magnitude.

Normalized price charts show closing-price returns in each listing's currency. They exclude cash distributions, reinvestment, and FX conversion. They are not total-return or investor-currency performance charts.

Overview, ticker reports and AI ticker context require dated prices covering each fixed return horizon. A newly listed fund's since-inception change cannot stand in for a one-year or three-year return. These outputs recalculate from available observations rather than trusting undated summary percentages in an older cache. A covered, unchanged price has a zero return; insufficient history remains unavailable. Year boundaries use calendar years, including leap years.

Fund overview does not currently model expense ratios, NAV premiums or discounts, fund domicile, or distribution and hedging share-class policies. Listing currency is not fund base currency or hedge policy. Dividend cash yield is separate from SEC yield and total return; see [Dividends](#dividends-and-sectors).

Daily, weekly, and monthly comparisons use shared calendar dates, with each market retaining its source timestamps. Intraday comparisons require exact shared timestamps. Exchange closing times may differ; weekly and monthly bars can cover a partial period. See [comparison alignment and baselines](price-comparisons.md).

Correlation and relationship views calculate close-to-close returns between shared observations. Missing dates are not filled to manufacture a sample. Returns use local prices without currency conversion; different exchanges can close at different times. Correlation requires enough shared returns and nonzero variance.

Relationship graph controls stay in the footer: `t` cycles the time range, `p` cycles the rolling observation window, `c` toggles correlation, and `f` toggles the fit line. Each action is clickable and shows its current state. In narrow panes, `+` means enabled and `−` means disabled.

Dated missing closing prices remain gaps through history caching and chart extraction, including responses with no usable prices. An alternate source can recover a gap at the same reported timestamp; unresolved dates remain gaps. Missing prices do not establish usable coverage or advance price freshness. An explicit finite zero or negative source price is retained as reported; individual calculations apply their own eligibility rules.

Contradictory OHLC bars are unavailable rather than silently repaired. Charts leave gaps and dependent risk calculations can be unavailable. These are current data problems and remain visible in the terminal.

Chart controls: select ranges and intervals above the plot; click a legend entry to hide or restore a series; use **+ add series** to add one. In a narrow legend, scroll over the row or use `[` / `]` to reveal each series; Space toggles the selected series. The existing footer offers **Series**, **Indicators**, **Formulas**, and **Share**, also available with `s`, `i`, `f`, and `y`. `t` opens the interval picker. Sharing publishes a chart snapshot; pane sharing is available from the pane menu.

## Financial statements and valuation

Statements are the latest available source snapshots and may include restatements. Historical as-of values are not reconstructed. A period end identifies the reporting period, not necessarily when every metric became public.

Financial table headers retain reporting currencies and date-source markers: **P** means a provider period date, which may be approximate; **S** means a SEC-corroborated fiscal date. Filing evidence identifies the period without establishing a publication date for every metric. Mixed or missing reporting currencies are not silently converted.

The table's TTM column identifies the ending quarter, including when quarterly coverage lags the latest annual report. Its JSON export retains the four source periods and their date evidence. Derived field availability requires every input used for that field; opening cash follows the first quarter and closing balances follow the last. Filing dates do not fill missing publication dates for unrelated fields.

Monetary growth requires matching known reporting currencies. A source-wide reporting currency can fill missing row metadata only when the statement history does not contradict it; headers and exports use the same qualification, including periods outside the selected table. Each row's own reported currency takes precedence. Share-count growth remains comparable across a reporting-currency change; monetary values remain visible without a growth estimate when units are unknown or incompatible. `FA --period annual` and `FA --period quarterly` reports keep the requested coverage and report it unavailable instead of substituting the other period. Interactive tabs select and visibly identify the available period.

Overview monetary fundamentals show **(ccy?)** when their aggregate currency is missing. The reported amounts remain unchanged; neither the listing currency nor statement currency establishes their units. Explicit minor units such as GBp remain attached to the original amounts, including EPS.

Chart-derived P/E, price/sales, EV/sales, EV/EBITDA and price/free-cash-flow require compatible price and statement currencies. A statement's own currency takes precedence; aggregate reporting currency fills missing row metadata only when the other statements do not contradict it. Explicit minor units such as GBp/GBX convert to GBP without an FX assumption. Foreign or unknown currency pairs remain unavailable with a chart and export warning. Separately converted summary fundamentals do not establish historical statement units, and this conversion does not change provider share or depositary-receipt bases.

These derived multiples omit the Current observation when its quote is explicitly stale or has an invalid price or timestamp; valid historical ratios remain available. Historical calculations select the latest source price at or before the statement's availability date, then validate it. An invalid selected price leaves a gap instead of borrowing an older close. Contradictory OHLC values and rejected quote inputs remain in export diagnostics, and affected exports are marked incomplete. A quote's regular-session high/low does not constrain a valid after-hours price.

Current multiples use the latest available reporting period before evaluating the ratio. A loss, missing denominator, or incompatible currency cannot substitute an older profitable period. Automatic period selection uses TTM input coverage rather than whether the resulting ratio is meaningful; known nonpositive TTM earnings do not trigger an annual fallback. Valid historical ratios retain their original reporting dates.

Financial charts retain known reporting periods as gaps when a metric is missing or a ratio is unavailable. An incomplete TTM window also leaves a gap until four compatible quarters are available again. Lines break across these gaps, and observation limits count usable values while retaining intervening and trailing gaps. A real zero remains a value. Entirely absent fiscal periods are not reconstructed. An explicit latest gap leaves the idle legend unavailable; selecting an earlier observation still shows its value. Price markers likewise cannot replace a missing latest bar with an older close.

SEC EPS uses corroborated split-adjusted share bases. Unverified bases are unavailable. Nonpositive P/E values display as **N/M** and are excluded from meaningful P/E rankings.

Chart-derived P/E preserves finite reported diluted EPS, including zero. When it is absent or unusable, the fallback divides reported common-shareholder income by the first positive share count available: diluted average shares, basic average shares, ordinary shares, then issued shares. Aggregate net income is used only when common income is unavailable. This is a derived income-per-selected-share estimate, not reconstructed reported diluted EPS: the source may omit convertible-claim numerator adjustments or a compatible depositary-receipt basis. The app does not guess those adjustments or deduct preferred/minority claims a second time. Reported EPS and the financial-statement rows remain unchanged.

TTM fallback income requires four complete quarters of one numerator field; partial common-income coverage withholds the fallback even if aggregate income is complete. Complete reported EPS still takes precedence. TTM average shares use the arithmetic mean of four reported quarterly averages, an approximation rather than a reconstructed daily weighted annual denominator; balance-sheet share counts remain period-end values. Availability follows the selected income and share fields, including every quarterly input used in a derived value.

Market capitalization can come from a financial snapshot when a current quote does not supply it. Its retrieval time is not its valuation date. Source and freshness details remain attached to the affected value; market-cap comparisons require a valid currency conversion.

Relative Valuation excludes explicitly stale quote prices, changes, and quote market caps from comparisons. Its exports retain the original quote, source timestamp and stale status, and identify incomplete output. Separately reported fundamentals and fallback market caps retain their own source and retrieval time; these are not dated by the rejected quote.

Bank capital metrics and REIT FFO/AFFO depend on source coverage. Operating cash flow is not a substitute for FFO/AFFO. Missing measures are identified in the financial view.

## Insider filings

INS retains Form 4 and Form 4/A disclosures separately, with their filing accession, source filing date, transaction dates, reporting owners and explanations. An amendment is labeled in the list; opening it retains its declared original filing date, footnotes and remarks. The existing filing action opens the SEC source. Reports preserve those fields and the transaction's footnote references.

[SEC Form 4, General Instruction 9](https://www.sec.gov/files/form4.pdf) permits amendments that add lines, correct particular lines or explain other changes. Unchanged original lines need not be repeated. The original filing date and owner CIKs can narrow the potentially affected filings, but do not identify transaction lines to replace. INS therefore keeps the disclosures as filed without inventing replacement or additive transactions. Affected security/side totals are unavailable; independent filings remain usable. Missing amendment identity broadens the uncertain scope. Unknown prices remain unknown, and the 90-day summary still covers only loaded non-derivative purchases and sales.

Amendment status uses the existing footer. Headless reports retain the candidate original accessions and mark affected output incomplete, including an amendment that contains explanations without transaction lines. Owner filtering preserves amendment context for the selected owner's original filings. The loaded window is limited; this is disclosure history, not a reconstructed position ledger or a guarantee that every later amendment has been loaded.

## Treasury curve

GC plots constant-maturity Treasury yields against elapsed maturity, with month/year axis and cursor labels. The table retains each tenor's published observation date. The 10Y−2Y spread is measured in basis points; a negative value indicates inversion. Missing tenors remain unavailable, and a curve requires matching dates.

Use the existing Date footer action (`d`) to enter an as-of date, then Enter or View to submit. Latest (`l`) returns to the latest published curve. A holiday or weekend request uses the latest preceding published session within the lookup window; the requested date and observation date remain distinct. Refresh time is not the observation date.

## Portfolio analytics

P&L for manual portfolios covers current holdings. Manual portfolios have no cash-flow performance history; reconcile corporate actions through **PF → Set position**. Distributions are not automatically credited.

Broker contracts without a canonical contract ID use their supplied definition, including local symbol, security type, currency, venue, expiry, right, strike, multiplier and trading class. Changing that definition requires its own quotes and history; an older symbol-only cache cannot establish their identity. Broker resync preserves the supplied definition for each position. Older positions without that identity retain a broker route only when their stored declarations match uniquely; resync establishes missing ownership. Independent issuer fields can still use public-symbol enrichment.

A missing position cost stays unavailable; it is not zero. Portfolio and ticker views use each lot’s known cost and usable current quote before falling back to that lot’s broker-reported snapshot. Mixed results retain both bases, and one unknown lot prevents a complete P&L total. A Broker P&L column uses snapshots; a Mixed P&L column includes both current calculations and snapshots. Broker snapshot profit does not acquire the live quote’s timestamp; position feeds without a profit timestamp leave it unknown. Missing cost or a zero total cost prevents a percentage return, even when absolute P&L is available. JSON/CSV exports retain the selected P&L basis and cost availability. Older stored zero costs cannot be distinguished from explicit zero: resync the broker position or correct a manual position to establish the intended cost.

Sector weights use gross position values and exclude cash. Fund constituents and ETF overlap are not available; funds are grouped separately. Missing position prices or FX prevent complete weights.

Sharpe and beta are estimates for a basket of current holdings and weights, rather than a reconstruction of historical account performance. They use price returns and exclude cash, fees, distributions and historical trades. Sharpe assumes a fixed 5% annual risk-free rate and 252 trading sessions per year; beta uses SPY as the benchmark. They require usable price histories for every nonzero holding. Each sample uses the same start and end dates for all holdings at fixed current weights; a newer listing shortens the common window instead of reallocating its missing weight. Dated missing or nonpositive closes break adjacent returns. Beta matches both interval endpoints with SPY, so a multi-session return is not paired with a one-session return sharing only its end date. The displayed dates and count identify the actual samples; absent dates across every source cannot establish an exchange calendar. A contradictory holding history suppresses the basket estimates. An invalid benchmark history suppresses beta independently of Sharpe.

Sharpe qualifies the whole sample against published sessions for every holding's requested listing venue. Both endpoints must be sessions with one source observation per date, and no trading session may lie between them. Source timestamps must consistently use midnight-UTC date labels, the same declared-venue wall-clock time on the labelled session date, or verified actual session-close times. This preserves exchange-open labels through DST and the verified regular 16:00/early 13:00 New York close convention, while rejecting sparse cross-midnight intraday observations. Mixed or unverified timestamp conventions remain unavailable. Actual-close schedule coverage is NYSE venues in 2025–2028 and Nasdaq in 2026; other timestamp conventions do not borrow those early-close dates. Legitimate weekend, holiday-reopening and early-close sessions remain in the sample; returns are never filtered to calendar weekdays or rescaled to guess a daily rate. Missing sessions and unsupported calendar coverage withhold Sharpe. Beta checks timestamp eligibility independently for both holdings and SPY, retaining valid endpoint-matched multi-session returns and unknown calendar years when their timestamp conventions are established. Nonmidnight SPY timestamps with no declared venue remain unverified. Routing venues such as SMART do not establish the listing calendar.

Published calendar coverage is NYSE/NYSE American/NYSE Arca and named NYSE National/Chicago/Texas venues for 2025–2028, and Nasdaq for 2025–2026, checked September 12, 2026. Sources are the [NYSE 2025–2027 announcement](https://ir.theice.com/press/news-details/2024/NYSE-Group-Announces-2025-2026-and-2027-Holiday-and-Early-Closings-Calendar/default.aspx), [NYSE 2026–2028 schedule](https://www.nyse.com/trade/hours-calendars), [NYSE Carter closure](https://ir.theice.com/press/news-details/2024/The-New-York-Stock-Exchange-Will-Close-Markets-on-January-9-to-Honor-the-Passing-of-Former-President-Jimmy-Carter-on-National-Day-of-Mourning/default.aspx), [Nasdaq 2025 table](https://www.nasdaq.com/docs/2025/01/06/2025holidayandtradinghours.pdf), [Nasdaq 2026 table](https://www.nasdaqtrader.com/Trader.aspx?id=Calendar), and [Nasdaq Carter closure](https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2024-87). The model retains this source basis and any rejected interval. Coverage includes the January 9, 2025 closure and does not invent a December 31, 2027 closure. It is a bounded published schedule, without a live exceptional-closure feed or inferred coverage for other venues and years.

The benchmark request explicitly identifies SPY on NYSE Arca in USD, ISIN US78462F1030, following the [issuer's listing table](https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy) checked September 12, 2026. Beta qualifies timestamps on its actual matching sample only; an unrelated older observation outside that sample cannot invalidate an otherwise valid comparison. The model retains the benchmark identity, source timestamps, matching sample, and qualification results.

Broker account-value history includes deposits and withdrawals. Investment returns require cash-flow adjustments. Broker-reported return series may not specify their calculation method. Currency values and percentage returns retain distinct axis labels. Account-value currency comes only from the history source; portfolio/display currency settings do not convert that history or establish its currency. The chart preserves elapsed calendar time and known missing dates. A later row at the same timestamp replaces the earlier row, including withdrawn values; missing values break the line instead of joining observations across the gap. Missing observations and cached data remain identified in the UI.

## Dividends and sectors

Dividend cash yield excludes taxes and reinvestment. SEC yield, tax components, and future payments are not modeled. Forward yield is an estimate rather than a guaranteed distribution. Dividend amounts and reference prices must use compatible listing currencies and units.

`DVD` is a cash-history view, not a next-quarter cash-flow calendar. History rows use ex-dates, not the dates cash reaches an account. Recent cadence is inferred from those ex-dates; it does not establish an announced schedule. A source-reported upcoming payment date can appear as Next Pay, but is not linked to a projected amount. The provider-backed history supplies ex-dates only. Missing payment dates remain unavailable. Forward/share is a provider-indicated annual rate, not a forecast of the next distribution. No FX conversion, withholding, or net account income is calculated.

Cash events require their source's currency and units; a quote or separate summary cannot supply missing history units. Invalid or missing records make cash totals, growth, cadence, and the TTM chart unavailable while valid history rows remain visible with a failure status. A confirmed empty history still has zero trailing cash. An unavailable source does not establish zero cash. A separately reported forward rate can remain available when its own currency is known and compatible, even when chart history is unusable; an unknown chart-price denomination cannot supply its yield denominator. On an integrity failure during refresh, retained history rows keep their own units and retrieval time while current cash totals stay unavailable. A confirmed empty response clears those retained rows.

Dividend reference prices retain their own source timestamp, including Yahoo's regular-session price when a separate quote is unavailable. The footer prioritizes that timestamp and shows the separate history retrieval time when space permits; exports retain both. Stale prices and missing price timestamps remain explicit. Fetching cash history does not refresh the time of its reference price.

TTM cash/share sums reported cash with ex-dates within the trailing calendar year. The chart changes on ex-dates and when earlier payments leave that window, holding each level between changes. Cash growth compares complete trailing-year windows; a positive baseline followed by no cash gives −100%, while a zero or incomplete baseline has no defined growth rate. Special distributions remain part of reported cash.

Sector and industry ETF returns are price returns in the listing currency, without reinvested distributions. Rankings use a shared ending session and calendar-month/year boundaries, using a prior close for holidays. Missing or inconsistent endpoints remain unavailable. A reported baseline still establishes the shared starting session when that ETF lacks an ending price; another ETF cannot use an older start because its peer becomes unavailable. A successful refresh does not make an old quote current.

## FX matrix

`r` refreshes the selected currencies through the provider, and automatic refresh follows the configured interval. Ordinary renders reuse cached rates. A refresh can still return the provider's cached observation; its source date and any stale or failure status remain visible.

One unit of the row currency buys the amount in the column currency. Indicative cross rates are calculated through USD legs, whose observation times can differ. Missing, stale, or unknown observation times appear as current status.

The base-currency axis remains visible during horizontal scrolling; partially covered values are shortened with an ellipsis. CSV export retains the full matrix and appends each currency's raw USD leg, observation time, retrieval time, source, and current status. Each cross uses its row's leg divided by its column's leg; same-currency cells are identity. Exported provenance belongs to the displayed rates, and unknown observation times remain blank rather than being replaced by retrieval time.

## Short interest

Short interest is outstanding short positions at each settlement date, not daily short-sale trading volume. FINRA supplies settlement history, average daily volume and days to cover. Yahoo is a fallback with current and prior settlement shares; its supplied current days-to-cover ratio and percentage of float remain attached to the current record.

An undated float cannot establish a historical settlement's denominator. Missing float percentages stay unavailable, including the prior settlement. Average daily volume is not reconstructed from Yahoo's reported ratio; FINRA's independently supplied volume remains available. Known zero values remain zero. The date column stays visible during horizontal scrolling, and exports retain every configured financial column.

## Credit spreads

CRD shows daily closing option-adjusted spreads for the ICE BofA US Corporate (US IG), US High Yield (US HY), and AAA, AA, A, and BBB US Corporate indices from FRED. Source percentages are converted to basis points; 1D is the change from the previous available observation. These are spreads, not bond yields.

Each series keeps its own observation date. A shared date appears in the footer when all displayed observations agree; otherwise an AS OF column identifies each row's date. Refresh time does not change an observation date. Headless reports retain each FRED series identifier, title, units, frequency, and date.

## Options

OVME uses a European-exercise Black–Scholes model. It does not model early exercise or discrete dividends. Theta is per day; vega is per volatility percentage point; rho is per rate percentage point. The UI keeps these units beside their values. A positive input exactly at the model’s discounted zero-volatility payoff has a 0% boundary solution. Nearby prices within the cumulative-normal approximation’s price-error bound cannot resolve IV and remain unavailable; this is not an estimate of quote precision or realized volatility. The asymptotic maximum has no finite IV, and the solver retains its 500% ceiling. Submitted calculator inputs retain their entered precision while editing.

OMON HV30 is the annualized sample standard deviation of 30 daily log returns from 31 distinct reported observations, using 252 trading days per year. A later correction replaces the same timestamp. Missing or nonpositive closes and contradictory OHLC inside that window make HV30 and IV/HV unavailable; they are not skipped to bridge a return. A quote explicitly marked stale cannot seed underlying-dependent Greeks, ATM selection, or the calculator. Contract quotes remain visible with their own timestamps.

OVME values are per underlying unit, not a position or contract total. Rates and continuous dividend yield are entered in percent; time uses calendar days, retaining fractional days. A chain expiry date is seeded at 16:00 New York with historical daylight-saving offsets. Verify and edit the time for other settlement schedules or early closes, especially index options. The calculator does not resolve adjusted deliverables or contract multipliers, model multi-leg payoffs, or compute assignment outcomes.

OMON retains the selected expiration date when a refreshed catalogue reorders or removes other dates. If that selected date is unavailable, its table and calculator remain unavailable until the date recovers or another date is selected.

A calculator opened from a chain uses a saved contract observation. Its quote and last-trade timestamps are separate; neither makes a saved quote executable. The market reference identifies midpoint, last, or manual input. Crossed or one-sided quotes do not supply a valid midpoint.

## Earnings and corporate actions

Event EPS and consensus can use an unspecified accounting basis, while TTM values come from statements. Fiscal period ends are not announcement dates. Open an event row for its source inputs and dates.

Consensus estimates are forecasts for the stated fiscal period. The provider's prior-year input can itself be an estimate; it does not establish a reported result. Fetched timestamps identify retrieval, not when consensus was revised. Filing evidence corroborates a fiscal period without verifying every reported metric.

Split-feed factors may include spinoff price adjustments. Merger terms, spinoff distributions, and security conversions are not covered. Source failures and unavailable event data remain visible rather than appearing as an empty event calendar.

## Earnings estimate comparisons

ERN groups and displays announcement dates on the same UTC calendar day. Exact call times, when supplied without a market-session label, use your local time. EPS 30D is the current estimate minus the estimate from thirty days earlier; a seven-day observation cannot fill a missing thirty-day value. REV 30D shows upward/downward revision counts over that same thirty-day window. An unknown count remains unavailable rather than becoming zero, and a directional color requires both counts. The CLI retains separately named seven-day and thirty-day source fields.

EPS and revenue retain their own explicit forecast currencies; neither inherits the listing currency or the other's currency. A `?` currency is unknown. Explicit minor-unit codes such as GBp/GBX normalize once to GBP; no exchange-rate or ADR conversion is inferred. EPS 30D requires both values to have the same known currency and forecast period. EST END is the provider's fiscal-period end when the available estimates agree, distinct from the announcement date; an unspecified or mixed period remains unavailable. Scroll horizontally to reach the remaining estimate columns in a narrow pane.

Calendar fallback values keep their own unknown currency and fiscal period. Trend-only ranges, growth, counts, and revisions are withheld from the displayed fallback's context; range endpoints from incompatible sources are not combined. The CLI's `estimateBasis` records each selected field's source, period, explicit currency code, and original `sourceValue`. `sourceEstimates` preserves all source-selected values after minor-unit normalization, including values withheld from the comparable top-level fields.

## AI research context

Ask AI and ticker attachments in the AI workspace use the available quote, summary fundamentals, and latest annual statement. Monetary amounts retain their original values and explicit source currency, including minor units such as GBp. The configured base currency is a preference; these inputs are not converted. Listing, summary, and statement currencies remain independent, and unknown units remain unknown. Zero values and numeric precision are preserved; margins, yields, and returns from fundamentals are identified as fractions.

The context includes available source, observation, retrieval, stale-state, and statement-history failure information. Retrieval time does not establish a valuation date. Annual period identity, whole-row availability, and individual field availability remain distinct. This attachment is a snapshot of those inputs, not a complete filing or a guarantee that a provider's data is current.

## Annual risk-factor reports (RISK)

Risk reports use the filing year of a company's Form 10-K, rather than an assumed fiscal year. The filing date identifies the source document; “Report updated” identifies the derived risk report. Risk headings and source excerpts come from the filing, while the overview and notes are analysis. The available comparison is the report's supplied change analysis; a missing annual filing is not synthesized. Foreign issuers filing Form 20-F are not covered by this 10-K report service.

Opening RISK follows the newest discovered report. Selecting a year keeps that filing selected when the standard `r` command refreshes discovery. New ticker/year requests clear the preceding report before loading, so its filing action cannot point to another selection. Source dates remain unchanged during refresh. Historical reports can be cached for rereading; a failed refresh can retain the same report with its original retrieval time and an active footer failure. Missing or denied report responses clear that report. The discovery list has a six-hour freshness window; failed forced refreshes are retried on reopening within the same runtime.

`gloomberb fn RISK AAPL --year 2025` reads that specific filing without requiring latest discovery. Omit `--year` (or use `latest`) for the newest discovered report; `--refresh` bypasses the corresponding caches. JSON and text export preserve source dates, the filing URL, source excerpts and separate analysis. A cached latest list after a discovery failure makes the report incomplete and discloses the failure; an independently available explicit historical report does not depend on the discovery list. Retrieval timestamps describe cache freshness and do not move the filing or report-update dates forward.
