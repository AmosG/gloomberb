import {afterAll,afterEach,expect,test} from "bun:test";
import {writeFileSync} from "node:fs";
import { apiClient, setCloudApiFetchTransport } from "../../../api-client";
import { buildHeadlessFunctionReport } from "../../../cli/pane-functions/headless";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { createTestDataProvider } from "../../../test-support/data-provider";
import { createDefaultConfig } from "../../../types/config";
import { attachRiskFactorsPersistence, resetRiskFactorsPersistence } from "./data";
import { riskFactorsHeadless } from "./headless";
import { list, report } from "./test-fixtures";
const out=process.env.RISK_HEADLESS_OUT;
let requests:string[]=[];const cases:any[]=[];
const originalFetch=globalThis.fetch;const external:string[]=[];
globalThis.fetch=(async(input:unknown)=>{external.push(String(input));throw new Error("External request blocked");}) as typeof fetch;
afterEach(()=>{resetRiskFactorsPersistence();setCloudApiFetchTransport(null);apiClient.dispose();requests=[];});
afterAll(()=>{if(out)writeFileSync(`${out}/headless-observations.json`,JSON.stringify({cases,external},null,2));globalThis.fetch=originalFetch;if(external.length)throw new Error("Unexpected external request");});
function transport(fn:(path:string)=>Response){setCloudApiFetchTransport((async(input:unknown)=>{const path=new URL(String(input)).pathname;requests.push(path);return fn(path);}) as typeof fetch);}
async function run(year="latest",refresh=false){return buildHeadlessFunctionReport({headless:riskFactorsHeadless,token:"RISK",label:"Risk Factors",options:{year,refresh},instance:{settings:{}},capability:{id:"risk-factors"}} as never,{dataProvider:createTestDataProvider(),config:createDefaultConfig("/tmp/unused-risk-headless")} as never,"CONTROL");}
function capture(name:string,result:Awaited<ReturnType<typeof run>>){if(out){writeFileSync(`${out}/${name}.json`,JSON.stringify(result.data,null,2));writeFileSync(`${out}/${name}.txt`,result.text);}cases.push({case:name,requests:[...requests],complete:result.data.complete,metadata:result.data.metadata});}

test("actual RISK report distinguishes a stale latest discovery from an independently valid historical filing",async()=>{
 const store=new MemoryPluginPersistence();attachRiskFactorsPersistence(store);store.seedResource("reports","CONTROL",list([2025]),{sourceKey:"risk-factors",schemaVersion:1,stale:true});store.seedResource("report","CONTROL:2025",report(2025),{sourceKey:"risk-factors",schemaVersion:1});
 transport(()=>new Response("Discovery unavailable",{status:503}));const latest=await run();capture("latest-stale",latest);expect(latest.data.complete).toBe(false);expect(latest.data.metadata).toMatchObject({reportYear:2025,listStale:true,filedAt:report(2025).filedAt,updatedAt:report(2025).updatedAt,docUrl:report(2025).docUrl});expect(latest.text).toContain("Discovery unavailable");expect(latest.text).toContain("Source 2025 text");
 requests=[];const historical=await run("2025");capture("historical-valid",historical);expect(historical.data.complete).toBe(true);expect(historical.data.metadata).toMatchObject({requestedYear:"2025",latestDiscoveryChecked:false,listStale:false});expect(requests).toEqual([]);
});

test("actual latest RISK export preserves source text, separate analysis and full change provenance",async()=>{
 const current=report(2026);current.diff={added:[0],removed:[{heading:"Retired source risk",group:"Business",excerpt:"Prior filing text"}],reworded:[],matched:0,priorRiskCount:1};current.notes.added=[{index:0,text:"Model analysis of added risk"}];current.notes.removed=[{index:0,text:"Model analysis of removed risk"}];
 transport(path=>path.endsWith("/CONTROL")?Response.json(list([2025,2026])):Response.json(current));const result=await run("latest",true);capture("latest-current",result);
 expect(result.data.complete).toBe(true);expect(result.data.metadata).toMatchObject({reportYear:2026,filedAt:current.filedAt,updatedAt:current.updatedAt,diff:current.diff});expect(result.text).toContain("Source 2026 text");expect(result.text).toContain("Model analysis of added risk");expect(result.text).toContain("Prior filing text");expect(result.text).toContain(current.docUrl);
});

test("an explicit missing filing fails without silently selecting a different year",async()=>{
 transport(path=>path.endsWith("/2024")?new Response("Requested 2024 report not found",{status:404}):Response.json(list([2026])));
 await expect(run("2024")).rejects.toThrow("Requested 2024 report not found");expect(requests).toEqual(["/public/risks/CONTROL/2024"]);cases.push({case:"missing-year",requests:[...requests],reportProduced:false});
});

test("empty discovery does not fabricate the current annual report and invalid year input never requests one",async()=>{
 transport(()=>Response.json(list([])));await expect(run()).rejects.toThrow("No 10-K risk reports on file for CONTROL");requests=[];await expect(run("2025-26")).rejects.toThrow("four-digit filing year or latest");expect(requests).toEqual([]);cases.push({case:"empty-and-invalid",reportProduced:false});
});
