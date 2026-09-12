import { expect, test } from "bun:test";
import { loadYahooOptionsChain } from "./options";
test("Yahoo activity preserves numeric zero and does not coerce missing or invalid counts", async () => {
    const values = [undefined, null, "0", -1, Number.NaN, Infinity, 0, 12];
    const input = values.map((value, index) => ({ contractSymbol: `OPTION${index}`, strike: index + 1, volume: value, openInterest: value }));
    const chain = await loadYahooOptionsChain({ ticker: "AAPL", exchange: "NASDAQ", fetchJsonWithCrumb: async () => ({ optionChain: { result: [{ expirationDates: [1], options: [{ calls: input, puts: [] }] }] } }) as any });
    expect(chain.calls.map(contract => contract.volume)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, 0, 12]);
    expect(chain.calls.map(contract => contract.openInterest)).toEqual(chain.calls.map(contract => contract.volume));
    expect(input[1]!.volume).toBeNull();
    expect(input[2]!.volume).toBe("0");
    expect(JSON.parse(JSON.stringify(chain)).calls[0]).not.toHaveProperty("volume");
    expect(JSON.parse(JSON.stringify(chain)).calls[6]).toMatchObject({ volume: 0, openInterest: 0 });
});
