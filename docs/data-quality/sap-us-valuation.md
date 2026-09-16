SAP US enterprise valuation, September 16, 2026
==============================================

The SAP/NYSE/USD Cloud response repeats a confirmed invalid Twelve Data observation: enterprise value 4,095,338,359,014, EV/revenue 92.879 and 1,154,204,232 outstanding shares. The raw source also carries a 14,500,653,521-share float and quarter end 2026-06-30. The upstream calculation error and enterprise-value currency are not independently established.

[SAP's half-year filing](https://www.sec.gov/Archives/edgar/data/1000184/000110465926087251/tm2621275d1_ex99-2.htm) reports cash EUR10.511bn, debt carrying amount EUR8.205bn and total liabilities EUR30.361bn. These balances do not support that trillion-scale valuation above the source's approximately USD249bn capitalization. The app does not construct a replacement from incomplete cash, debt and FX inputs.

During a rolling deployment, the client withdraws each exact captured bad value only for USD SAP with NYSE or unspecified venue, the matching share count and Twelve Data or legacy Cloud provenance. Sparse responses use stable quote metadata or the requested listing; an explicit response identity takes precedence. Other fields, foreign listings, providers and corrected observations remain available. The same guard applies to cached Cloud responses regardless of cache version. Explicit withdrawal markers survive sparse merges; a later authoritative correction can restore the affected field. The backend validates the richer raw period/share fingerprint.

Unavailable enterprise value uses the existing dash in overview, with the active source failure behind the existing footer warning. No permanent explanatory paragraph or new control is added. This bound does not attest other SAP financial metrics or classify different future observations.
