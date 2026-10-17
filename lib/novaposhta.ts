import "server-only";

const URL = "https://api.novaposhta.ua/v2.0/json/";

async function call<T>(modelName: string, calledMethod: string, methodProperties: Record<string, unknown>): Promise<T[]> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: process.env.NOVAPOSHTA_API_KEY ?? "", modelName, calledMethod, methodProperties }),
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) throw new Error(`Nova Poshta ${calledMethod} → ${res.status}`);
  const json = (await res.json()) as { success: boolean; data: T[]; errors: string[] };
  if (!json.success) throw new Error(`Nova Poshta ${calledMethod}: ${json.errors.join(", ")}`);
  return json.data;
}

export type NpCity = { ref: string; name: string; area: string };
export type NpWarehouse = { ref: string; name: string; number: string; postomat: boolean };

export async function searchCities(query: string): Promise<NpCity[]> {
  const data = await call<{ Ref: string; Description: string; AreaDescription: string; SettlementTypeDescription: string }>(
    "Address",
    "getCities",
    { FindByString: query, Limit: "20", Page: "1" },
  );
  return data.map((c) => ({ ref: c.Ref, name: c.Description, area: c.AreaDescription }));
}

export async function searchWarehouses(cityRef: string, query: string): Promise<NpWarehouse[]> {
  const data = await call<{ Ref: string; Description: string; Number: string; CategoryOfWarehouse: string }>(
    "Address",
    "getWarehouses",
    { CityRef: cityRef, FindByString: query, Limit: "50", Page: "1" },
  );
  return data.map((w) => ({ ref: w.Ref, name: w.Description, number: w.Number, postomat: w.CategoryOfWarehouse === "Postomat" }));
}
