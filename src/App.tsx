import { useState } from "react";

const SERVER = "https://georges-meal-planner-server.onrender.com";
const DENVER_TAX = 0.0881;
const DEFAULT_BUDGET = 150;
const TAXABLE_CATEGORIES = ["beverages", "soda", "candy", "alcohol", "beer", "wine", "paper goods", "cleaning", "personal care"];

const COMMON_ADDONS = [
  { category: "Breakfast", items: ["Eggs (dozen)", "Bacon", "Bread (loaf)", "Orange juice", "Cereal", "Oatmeal"] },
  { category: "Snacks", items: ["Chips", "Goldfish crackers", "Apples", "String cheese", "Granola bars", "Popcorn"] },
  { category: "Drinks", items: ["Milk (gallon)", "Apple juice", "Sparkling water", "Coffee", "Tea"] },
  { category: "Household", items: ["Paper towels", "Dish soap", "Trash bags", "Laundry detergent", "Aluminum foil", "Zip bags"] },
  { category: "Dairy Staples", items: ["Butter", "Shredded cheese", "Sour cream", "Cream cheese", "Yogurt"] },
];

const KEYS = {
  clientId: "gmp_client_id", clientSecret: "gmp_client_secret", claudeKey: "gmp_claude_key",
  storeZip: "gmp_store_zip", storeInfo: "gmp_store_info", token: "gmp_token", tokenExpiry: "gmp_token_expiry",
  feedback: "gmp_feedback", ratings: "gmp_ratings", plan: "gmp_plan", groceries: "gmp_groceries",
  mealHistory: "gmp_meal_history", budget: "gmp_budget", recipes: "gmp_recipes",
};

function ls(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key: string, val: string) { try { localStorage.setItem(key, val); } catch {} }
function lsParse<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

const API = {
  async askClaude(prompt: string, claudeKey: string): Promise<any> {
    const res = await fetch(`${SERVER}/api/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-claude-key": claudeKey },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`Claude error: ${res.status}`);
    return res.json();
  },

  async getKrogerToken(clientId: string, clientSecret: string): Promise<string> {
    const existing = ls(KEYS.token);
    const expiry = ls(KEYS.tokenExpiry);
    if (existing && expiry && Date.now() < Number(expiry)) return existing;
    const res = await fetch(`${SERVER}/api/kroger/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!res.ok) throw new Error(`Kroger auth failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    lsSet(KEYS.token, data.access_token);
    lsSet(KEYS.tokenExpiry, String(Date.now() + (data.expires_in - 60) * 1000));
    return data.access_token;
  },

  async findStore(token: string, zip: string) {
    const res = await fetch(`${SERVER}/api/kroger/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, zip }),
    });
    if (!res.ok) throw new Error(`Store lookup failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data as { id: string; name: string; address: string };
  },

  async searchProduct(token: string, storeId: string, query: string) {
    const res = await fetch(`${SERVER}/api/kroger/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, storeId, query }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    return data as { name: string; price: number | null; upc: string; category: string };
  },
};

interface Meal { name: string; description: string; doubled: boolean; }
interface Plan {
  monday: Meal; tuesday: Meal; wednesday: Meal; thursday: Meal; friday: Meal;
  saturday: Meal; sunday: Meal; ingredients: Ingredient[];
}
interface Ingredient { item: string; quantity: string; category: string; }
interface GroceryItem extends Ingredient { krogerName: string; price: number | null; upc: string | null; taxable: boolean; }
interface Groceries { items: GroceryItem[]; store: string; fetchedAt: string; }
interface StoreInfo { id: string; name: string; address: string; }
interface Rating { adultAvg: number; kidAvg: number; }
interface MealHistoryEntry { name: string; weekOf: string; adultRating?: number; kidRating?: number; }
interface Recipe {
  mealName: string; day: string; prepTime: string; cookTime: string; totalTime: string;
  servings: string; isQuick: boolean; isDoubled: boolean;
  ingredients: { item: string; quantity: string; note?: string }[];
  steps: { step: number; title: string; instruction: string; tip?: string }[];
  chefTips: string[];
}

export default function App() {
  const [tab, setTab] = useState("plan");
  const [clientId, setClientId] = useState(ls(KEYS.clientId) || "");
  const [clientSecret, setClientSecret] = useState(ls(KEYS.clientSecret) || "");
  const [claudeKey, setClaudeKey] = useState(ls(KEYS.claudeKey) || "");
  const [storeZip, setStoreZip] = useState(ls(KEYS.storeZip) || "80220");
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(lsParse(KEYS.storeInfo, null));
  const [plan, setPlan] = useState<Plan | null>(lsParse(KEYS.plan, null));
  const [recipes, setRecipes] = useState<Recipe[]>(lsParse(KEYS.recipes, []));
  const [groceries, setGroceries] = useState<Groceries | null>(lsParse(KEYS.groceries, null));
  const [budget, setBudget] = useState<number>(lsParse(KEYS.budget, DEFAULT_BUDGET));
  const [budgetInput, setBudgetInput] = useState(String(lsParse(KEYS.budget, DEFAULT_BUDGET)));
  const [showAddons, setShowAddons] = useState(false);
  const [checkedAddons, setCheckedAddons] = useState<string[]>([]);
  const [customAddon, setCustomAddon] = useState("");
  const [customAddonList, setCustomAddonList] = useState<string[]>([]);
  const [pendingIngredients, setPendingIngredients] = useState<Ingredient[]>([]);
  const [feedback, setFeedback] = useState<string[]>(lsParse(KEYS.feedback, []));
  const [ratings, setRatings] = useState<Record<string, Rating>>(lsParse(KEYS.ratings, {}));
  const [mealHistory, setMealHistory] = useState<MealHistoryEntry[]>(lsParse(KEYS.mealHistory, []));
  const [newFeedback, setNewFeedback] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [cartStatus, setCartStatus] = useState("");
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);

  const DAYS = [
    { key: "monday", label: "Monday", type: "main" },
    { key: "tuesday", label: "Tuesday", type: "quick" },
    { key: "wednesday", label: "Wednesday", type: "main" },
    { key: "thursday", label: "Thursday", type: "quick" },
    { key: "friday", label: "Friday", type: "main" },
    { key: "saturday", label: "Saturday", type: "leftover" },
    { key: "sunday", label: "Sunday", type: "leftover" },
  ];

  const totals = (() => {
    if (!groceries?.items) return null;
    let nonTax = 0, taxable = 0, missing = 0;
    groceries.items.forEach(i => {
      if (i.price === null) { missing++; return; }
      if (i.taxable) taxable += i.price; else nonTax += i.price;
    });
    const tax = taxable * DENVER_TAX;
    const grand = nonTax + taxable + tax;
    return { nonTax, taxable, tax, grand, missing, overBudget: grand > budget };
  })();

  function getRecentMeals() {
    const cutoff = Date.now() - 28 * 24 * 60 * 60 * 1000;
    return mealHistory.filter(m => new Date(m.weekOf).getTime() > cutoff).map(m => m.name.toLowerCase());
  }

  function getHighlyRatedMeals() {
    return Object.entries(ratings).filter(([_, r]) => (r.adultAvg + r.kidAvg) / 2 >= 9).map(([n]) => n.toLowerCase());
  }

  async function generatePlan() {
    if (!claudeKey) { setStatus("Please add your Claude API key in Setup first."); return; }
    setLoading(true);
    setStatus("Step 1 of 2 — Building your personalized meal plan...");

    const recentMeals = getRecentMeals();
    const highlyRated = getHighlyRatedMeals();
    const fbStr = feedback.length ? feedback.slice(-5).join("; ") : "none yet";
    const ratingsStr = Object.keys(ratings).length
      ? Object.entries(ratings).map(([n, r]) => `${n}: adults ${r.adultAvg}/10 kids ${r.kidAvg}/10`).join("; ")
      : "none yet";

    try {
      // Step 1: Generate meal plan
      const planResult: Plan = await API.askClaude(`
Generate a weekly dinner meal plan for a family of 5 (2 adults, kids ages 12 & 6, 1 additional adult).
Weekly grocery budget: $${budget}

Rules:
- 5 cooked dinners: monday tuesday wednesday thursday friday
- tuesday and thursday = QUICK meals under 30 minutes
- saturday and sunday = leftover nights
- Choose 2 of the 5 meals to double portions for leftovers (pick meals that reheat well)
- Kid-friendly, varied cuisines, NO repeated proteins across the 5 meals
- Maximum variety — different cuisine style each night
- AVOID these meals used in the last 4 weeks: ${recentMeals.length ? recentMeals.join(", ") : "none to avoid"}
- You MAY reuse highly rated meals (combined avg 9+/10) maximum once per month: ${highlyRated.length ? highlyRated.join(", ") : "none eligible yet"}
- Aim to keep total ingredient cost within $${Math.round(budget * 0.82)} to leave room for household add-ons
- Previous household feedback: ${fbStr}
- Previous meal ratings: ${ratingsStr}

Return ONLY this JSON (no markdown, no explanation):
{
  "monday":    { "name": "...", "description": "...", "doubled": true },
  "tuesday":   { "name": "...", "description": "...", "doubled": false },
  "wednesday": { "name": "...", "description": "...", "doubled": true },
  "thursday":  { "name": "...", "description": "...", "doubled": false },
  "friday":    { "name": "...", "description": "...", "doubled": false },
  "saturday":  { "name": "Leftovers", "description": "From Monday", "doubled": false },
  "sunday":    { "name": "Leftovers", "description": "From Wednesday", "doubled": false },
  "ingredients": [
    { "item": "chicken breast", "quantity": "3 lbs", "category": "meat" }
  ]
}`, claudeKey);

      setPlan(planResult);
      lsSet(KEYS.plan, JSON.stringify(planResult));
      setPendingIngredients(planResult.ingredients);

      // Step 2: Generate recipes in two batches
setStatus("Step 2 of 2 — Generating detailed recipes...");

const buildRecipePrompt = (meals: {day: string, meal: Meal, isQuick: boolean}[]) => `
You are a recipe generator. Return ONLY a valid JSON array. No text before or after. No markdown. No comments. Just the JSON array starting with [ and ending with ].

Generate detailed recipes for these meals for a family of 5 (2 adults, kids ages 12 & 6, 1 additional adult):
${meals.map(m => `- ${m.meal.name} (${m.day}${m.isQuick ? ", QUICK under 30 min" : ""}${m.meal.doubled ? ", DOUBLE portions for leftovers" : ""})`).join("\n")}

Return this exact JSON structure:
[
  {
    "mealName": "exact meal name here",
    "day": "monday",
    "prepTime": "15 min",
    "cookTime": "30 min",
    "totalTime": "45 min",
    "servings": "5 servings",
    "isQuick": false,
    "isDoubled": false,
    "ingredients": [
      { "item": "ingredient name", "quantity": "amount", "note": "prep note" }
    ],
    "steps": [
      { "step": 1, "title": "Step title", "instruction": "Detailed instruction here.", "tip": "Optional tip here" }
    ],
    "chefTips": ["tip 1", "tip 2"]
  }
]`;

const allDays = [
  { day: "monday",    meal: (planResult as any)["monday"]    as Meal, isQuick: false },
  { day: "tuesday",   meal: (planResult as any)["tuesday"]   as Meal, isQuick: true  },
  { day: "wednesday", meal: (planResult as any)["wednesday"] as Meal, isQuick: false },
  { day: "thursday",  meal: (planResult as any)["thursday"]  as Meal, isQuick: true  },
  { day: "friday",    meal: (planResult as any)["friday"]    as Meal, isQuick: false },
];

const batch1: Recipe[] = await API.askClaude(buildRecipePrompt(allDays.slice(0, 3)), claudeKey);
const batch2: Recipe[] = await API.askClaude(buildRecipePrompt(allDays.slice(3)), claudeKey);
const recipesResult = [...batch1, ...batch2];
setRecipes(recipesResult);
lsSet(KEYS.recipes, JSON.stringify(recipesResult));

      setShowAddons(true);
      setCheckedAddons([]);
      setCustomAddonList([]);
      setCustomAddon("");
      setStatus("");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  }

  async function confirmAddons() {
    setShowAddons(false);
    const addonIngredients: Ingredient[] = [
      ...checkedAddons.map(item => ({ item, quantity: "1", category: guessCategory(item) })),
      ...customAddonList.map(item => ({ item, quantity: "1", category: "other" })),
    ];
    const all = [...pendingIngredients, ...addonIngredients];
    if (clientId && clientSecret) {
      await buildGroceries(all);
    } else {
      setStatus("Plan saved! Enter your Kroger credentials in Setup to fetch live pricing.");
    }
  }

  function guessCategory(item: string): string {
    const l = item.toLowerCase();
    if (["juice","milk","water","coffee","tea","soda"].some(k => l.includes(k))) return "beverages";
    if (["paper towel","dish soap","trash bag","detergent","foil","zip bag"].some(k => l.includes(k))) return "household";
    return "pantry";
  }

  function addCustomAddon() {
    const t = customAddon.trim();
    if (t && !customAddonList.includes(t)) setCustomAddonList([...customAddonList, t]);
    setCustomAddon("");
  }

  function toggleAddon(item: string) {
    setCheckedAddons(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);
  }

  async function buildGroceries(ingredients: Ingredient[]) {
    setStatus("Connecting to King Soopers...");
    try {
      const token = await API.getKrogerToken(clientId, clientSecret);
      let store = storeInfo;
      if (!store) {
        store = await API.findStore(token, storeZip);
        setStoreInfo(store);
        lsSet(KEYS.storeInfo, JSON.stringify(store));
      }
      setStatus(`Found ${store.name} — fetching ${ingredients.length} prices...`);
      const items: GroceryItem[] = [];
      for (const ing of ingredients) {
        const p = await API.searchProduct(token, store.id, ing.item);
        items.push({
          ...ing,
          krogerName: p?.name || ing.item,
          price: p?.price ?? null,
          upc: p?.upc || null,
          taxable: TAXABLE_CATEGORIES.some(c => ing.category.toLowerCase().includes(c)),
        });
      }
      const g: Groceries = { items, store: store.name, fetchedAt: new Date().toLocaleDateString() };
      setGroceries(g);
      lsSet(KEYS.groceries, JSON.stringify(g));
      setStatus(`All prices loaded from ${store.name}!`);
      setTab("groceries");
    } catch (err: any) {
      setStatus(`Kroger error: ${err.message}`);
    }
  }

  function saveSettings() {
    const b = parseFloat(budgetInput) || DEFAULT_BUDGET;
    setBudget(b);
    lsSet(KEYS.budget, JSON.stringify(b));
    lsSet(KEYS.clientId, clientId);
    lsSet(KEYS.clientSecret, clientSecret);
    lsSet(KEYS.claudeKey, claudeKey);
    lsSet(KEYS.storeZip, storeZip);
    localStorage.removeItem(KEYS.storeInfo);
    localStorage.removeItem(KEYS.token);
    setStoreInfo(null);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 3000);
  }

  function setRating(meal: string, field: "adultAvg" | "kidAvg", val: number) {
    const current = ratings[meal] || { adultAvg: 0, kidAvg: 0 };
    const updated = { ...ratings, [meal]: { ...current, [field]: val } };
    setRatings(updated);
    lsSet(KEYS.ratings, JSON.stringify(updated));
  }

  function saveFeedback() {
    if (!newFeedback.trim()) return;
    const updated = [...feedback, newFeedback.trim()];
    setFeedback(updated);
    lsSet(KEYS.feedback, JSON.stringify(updated));
    setNewFeedback("");
    if (plan) {
      const weekOf = new Date().toISOString().split("T")[0];
      const entries: MealHistoryEntry[] = (["monday","tuesday","wednesday","thursday","friday"] as const)
        .map(day => {
          const meal = (plan as any)[day] as Meal;
          if (!meal || meal.name === "Leftovers") return null;
          const r = ratings[meal.name];
          return { name: meal.name, weekOf, adultRating: r?.adultAvg, kidRating: r?.kidAvg };
        }).filter(Boolean) as MealHistoryEntry[];
      const updatedHistory = [...mealHistory, ...entries].slice(-100);
      setMealHistory(updatedHistory);
      lsSet(KEYS.mealHistory, JSON.stringify(updatedHistory));
    }
  }

  function StarRow({ meal, field, label }: { meal: string; field: "adultAvg" | "kidAvg"; label: string }) {
    const current = ratings[meal]?.[field] || 0;
    const color = current >= 9 ? "#1D9E75" : current >= 6 ? "#BA7517" : current > 0 ? "#D85A30" : "#e0e0e0";
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "#999", marginBottom: 5 }}>{label}</div>
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {[1,2,3,4,5,6,7,8,9,10].map(n => (
            <button key={n} onClick={() => setRating(meal, field, n)}
              style={{ fontSize: 15, background: "none", border: "none", cursor: "pointer", color: n <= current ? color : "#e0e0e0", padding: "0 1px" }}>★</button>
          ))}
          {current > 0 && <span style={{ fontSize: 12, color: "#999", marginLeft: 6 }}>{current}/10</span>}
        </div>
      </div>
    );
  }

  const badge = (type: string): React.CSSProperties => (({
    quick:    { background: "#E1F5EE", color: "#0F6E56", padding: "2px 10px", borderRadius: 20, fontSize: 11 },
    leftover: { background: "#FAEEDA", color: "#854F0B", padding: "2px 10px", borderRadius: 20, fontSize: 11 },
    main:     { background: "#E6F1FB", color: "#185FA5", padding: "2px 10px", borderRadius: 20, fontSize: 11 },
  } as any)[type] || { background: "#E6F1FB", color: "#185FA5", padding: "2px 10px", borderRadius: 20, fontSize: 11 });

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: "8px 16px", fontSize: 14, cursor: "pointer", border: "none", background: "none",
    color: tab === t ? "#111" : "#999", borderBottom: tab === t ? "2px solid #111" : "2px solid transparent",
    fontWeight: tab === t ? 500 : 400, marginBottom: -1,
  });

  const btnP: React.CSSProperties = { padding: "9px 18px", fontSize: 13, border: "none", borderRadius: 8, background: "#111", color: "#fff", cursor: "pointer" };
  const btnS: React.CSSProperties = { padding: "9px 18px", fontSize: 13, border: "0.5px solid #ccc", borderRadius: 8, background: "none", cursor: "pointer", color: "#333" };
  const btnG: React.CSSProperties = { padding: "9px 18px", fontSize: 13, border: "none", borderRadius: 8, background: "#1D9E75", color: "#fff", cursor: "pointer" };
  const card: React.CSSProperties = { background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: 12 };
  const input: React.CSSProperties = { width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid #ddd", borderRadius: 8, marginTop: 4, boxSizing: "border-box" };
  const noticeStyle = (color: string): React.CSSProperties => ({
    background: color === "blue" ? "#f0f7ff" : color === "green" ? "#E1F5EE" : "#FFF3E0",
    borderLeft: `3px solid ${color === "blue" ? "#378ADD" : color === "green" ? "#1D9E75" : "#BA7517"}`,
    borderRadius: 8, padding: "0.75rem 1rem", fontSize: 13,
    color: color === "blue" ? "#444" : color === "green" ? "#0F4A30" : "#6D3F00", marginBottom: 12,
  });

  return (
    <div style={{ fontFamily: "system-ui,sans-serif", maxWidth: 920, margin: "0 auto", padding: "1rem 1.25rem" }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4, color: "#111" }}>Georges Meal Planner</h1>
      <p style={{ fontSize: 13, color: "#999", marginBottom: 24 }}>Weekly dinner planning for 5 people · King Soopers · Denver, CO</p>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e8e8e8", marginBottom: 24, overflowX: "auto" }}>
        {[["plan","This week's plan"],["groceries","Grocery list"],["recipes","Recipes"],["feedback","Ratings & feedback"],["settings","Setup"]].map(([t, label]) => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {/* ── PLAN TAB ── */}
      {tab === "plan" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "10px 14px", background: "#f8f8f8", borderRadius: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#555" }}>Weekly budget:</span>
            <span style={{ fontWeight: 500 }}>$</span>
            <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
              onBlur={() => { const b = parseFloat(budgetInput) || DEFAULT_BUDGET; setBudget(b); lsSet(KEYS.budget, JSON.stringify(b)); }}
              style={{ width: 80, fontSize: 15, fontWeight: 500, padding: "4px 8px", border: "0.5px solid #ddd", borderRadius: 6, textAlign: "center" }} />
            <span style={{ fontSize: 12, color: "#aaa" }}>Default is ${DEFAULT_BUDGET} — change anytime</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
            {[
              ["Est. total (with tax)", totals ? `$${totals.grand.toFixed(2)}` : "—", totals?.overBudget ? "#D85A30" : "#111"],
              ["Weekly budget", `$${budget}`, "#111"],
              ["Budget remaining", totals ? `$${(budget - totals.grand).toFixed(2)}` : "—", totals ? (totals.overBudget ? "#D85A30" : "#1D9E75") : "#111"],
            ].map(([label, val, color]) => (
              <div key={label as string} style={{ background: "#f8f8f8", borderRadius: 8, padding: "0.85rem 1rem" }}>
                <div style={{ fontSize: 12, color: "#999", marginBottom: 4 }}>{label as string}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: color as string }}>{val as string}</div>
                {label === "Est. total (with tax)" && totals?.overBudget && <div style={{ fontSize: 11, color: "#D85A30", marginTop: 2 }}>Over by ${(totals.grand - budget).toFixed(2)}</div>}
              </div>
            ))}
          </div>

          {showAddons && (
            <div style={{ ...card, border: "1.5px solid #378ADD", background: "#f9fcff", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>One more thing before we fetch prices...</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Would you like to add any extra items to your King Soopers trip?</div>
              {COMMON_ADDONS.map(group => (
                <div key={group.category} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{group.category}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    {group.items.map(item => (
                      <label key={item} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "4px 0", cursor: "pointer", color: "#333" }}>
                        <input type="checkbox" checked={checkedAddons.includes(item)} onChange={() => toggleAddon(item)} style={{ accentColor: "#378ADD" }} />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "0.5px solid #e8e8e8", paddingTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#888", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Anything else?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...input, marginTop: 0, flex: 1 }} type="text" value={customAddon}
                    onChange={e => setCustomAddon(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addCustomAddon()}
                    placeholder="Type an item and press Enter or click Add" />
                  <button style={btnS} onClick={addCustomAddon}>Add</button>
                </div>
                {customAddonList.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {customAddonList.map(item => (
                      <span key={item} style={{ background: "#E6F1FB", color: "#185FA5", fontSize: 12, padding: "3px 10px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}>
                        {item}
                        <button onClick={() => setCustomAddonList(customAddonList.filter(i => i !== item))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#185FA5", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <button style={btnG} onClick={confirmAddons}>
                  {checkedAddons.length + customAddonList.length > 0
                    ? `Add ${checkedAddons.length + customAddonList.length} extra item(s) & fetch prices`
                    : "No extras — fetch prices now"}
                </button>
                <button style={btnS} onClick={() => setShowAddons(false)}>Skip for now</button>
              </div>
            </div>
          )}

          <div style={card}>
            {DAYS.map((d, i) => (
              <div key={d.key} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: i < DAYS.length - 1 ? "0.5px solid #f5f5f5" : "none" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: "#bbb" }}>{d.type === "quick" ? "Quick meal" : d.type === "leftover" ? "Leftovers" : "Main cook"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 14 }}>{(plan as any)?.[d.key]?.name || "—"}</div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>
                    {(plan as any)?.[d.key]?.description || (d.type === "leftover" ? "Portions calculated from doubled meals" : "Generate a plan to populate")}
                    {(plan as any)?.[d.key]?.doubled && <span style={{ marginLeft: 6, fontSize: 11, color: "#0F6E56" }}>↑ doubled for leftovers</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span style={badge(d.type)}>{d.type}</span>
                  {d.type !== "leftover" && recipes.find(r => r.day === d.key) && (
                    <button onClick={() => { setTab("recipes"); setExpandedRecipe((plan as any)?.[d.key]?.name); }}
                      style={{ fontSize: 11, color: "#378ADD", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      view recipe →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={btnP} onClick={generatePlan} disabled={loading || showAddons}>
              {loading ? "Working..." : plan ? "Regenerate menu" : "Generate this week's menu"}
            </button>
            {plan && !showAddons && (
              <button style={btnS} onClick={() => { setPlan(null); setGroceries(null); setRecipes([]); localStorage.removeItem(KEYS.plan); localStorage.removeItem(KEYS.groceries); localStorage.removeItem(KEYS.recipes); setStatus(""); }}>
                Clear plan
              </button>
            )}
          </div>

          {status && !showAddons && (
            <div style={{ fontSize: 12, color: "#555", padding: "10px 0", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1D9E75", display: "inline-block", flexShrink: 0 }} />
              {status}
            </div>
          )}
        </div>
      )}

      {/* ── GROCERIES TAB ── */}
      {tab === "groceries" && (
        <div>
          {!groceries ? (
            <div style={noticeStyle("blue")}>Generate a meal plan first, then come back here for your King Soopers grocery list with live pricing.</div>
          ) : (
            <>
              {totals?.overBudget && <div style={noticeStyle("orange")}>⚠ Estimated total of <strong>${totals.grand.toFixed(2)}</strong> is ${(totals.grand - budget).toFixed(2)} over your ${budget} budget.</div>}
              {totals && !totals.overBudget && <div style={noticeStyle("green")}>✓ Within budget! ${totals.grand.toFixed(2)} of ${budget}.</div>}
              <div style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>{groceries.store} · {groceries.fetchedAt} · <span style={{ color: "#BA7517" }}>●</span> = taxable item</div>
              {(() => {
                const grouped: Record<string, GroceryItem[]> = {};
                groceries.items.forEach(i => { const c = i.category || "Other"; if (!grouped[c]) grouped[c] = []; grouped[c].push(i); });
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {Object.entries(grouped).map(([cat, items]) => (
                      <div key={cat} style={card}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, paddingBottom: 6, borderBottom: "0.5px solid #f0f0f0", textTransform: "capitalize" }}>{cat}</div>
                        {items.map((item, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderBottom: "0.5px solid #f5f5f5" }}>
                            <span style={{ color: "#333" }}>
                              {item.krogerName || item.item}
                              <span style={{ fontSize: 11, color: "#bbb", marginLeft: 4 }}>({item.quantity})</span>
                              {item.taxable && <span style={{ color: "#BA7517", marginLeft: 4, fontSize: 11 }}>●</span>}
                            </span>
                            <span style={{ color: "#999", fontSize: 12, whiteSpace: "nowrap" }}>
                              {item.price !== null ? `$${item.price.toFixed(2)}` : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}
              {totals && (
                <div style={{ ...card, marginTop: 4 }}>
                  {[
                    ["Groceries (non-taxable)", `$${totals.nonTax.toFixed(2)}`, false, false],
                    ["Taxable items subtotal", `$${totals.taxable.toFixed(2)}`, false, false],
                    ["Denver sales tax (8.81%)", `$${totals.tax.toFixed(2)}`, false, false],
                    ["Estimated total", `$${totals.grand.toFixed(2)}`, true, false],
                    ["Weekly budget", `$${budget.toFixed(2)}`, false, false],
                    [totals.overBudget ? "Over budget by" : "Under budget by", `$${Math.abs(budget - totals.grand).toFixed(2)}`, false, totals.overBudget],
                  ].map(([label, val, bold, danger]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: bold ? 15 : 13, fontWeight: bold ? 500 : 400, borderBottom: "0.5px solid #f5f5f5", color: bold ? "#111" : "#666" }}>
                      <span>{label as string}</span>
                      <span style={{ color: danger ? "#D85A30" : label === "Under budget by" ? "#1D9E75" : "inherit" }}>{val as string}</span>
                    </div>
                  ))}
                  {totals.missing > 0 && <div style={{ fontSize: 12, color: "#BA7517", marginTop: 8 }}>⚠ {totals.missing} item(s) had no price found — actual total may be slightly higher</div>}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button style={btnP} onClick={() => setCartStatus("Cart integration requires King Soopers account authorization (OAuth). This is the next feature we'll build — your list is ready to reference while you shop!")}>
                  Add all to King Soopers cart
                </button>
                <button style={btnS} onClick={() => plan && buildGroceries(plan.ingredients)} disabled={loading}>Refresh prices</button>
              </div>
              {cartStatus && <div style={{ ...noticeStyle("green"), marginTop: 10 }}>{cartStatus}</div>}
            </>
          )}
        </div>
      )}

      {/* ── RECIPES TAB ── */}
      {tab === "recipes" && (
        <div>
          {recipes.length === 0 ? (
            <div style={noticeStyle("blue")}>Generate a meal plan first — recipes for all 5 meals will appear here automatically.</div>
          ) : (
            recipes.map(recipe => {
              const isExpanded = expandedRecipe === recipe.mealName;
              return (
                <div key={recipe.mealName} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  {/* Recipe header */}
                  <div
                    onClick={() => setExpandedRecipe(isExpanded ? null : recipe.mealName)}
                    style={{ padding: "1rem 1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: isExpanded ? "#fafafa" : "#fff" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{recipe.mealName}</span>
                        {recipe.isQuick && <span style={{ background: "#E1F5EE", color: "#0F6E56", padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>quick</span>}
                        {recipe.isDoubled && <span style={{ background: "#E6F1FB", color: "#185FA5", padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>doubled for leftovers</span>}
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#999" }}>
                        <span>Prep: {recipe.prepTime}</span>
                        <span>Cook: {recipe.cookTime}</span>
                        <span>Total: {recipe.totalTime}</span>
                        <span>{recipe.servings}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 18, color: "#ccc", marginLeft: 12 }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>

                  {/* Expanded recipe */}
                  {isExpanded && (
                    <div style={{ padding: "0 1.25rem 1.25rem", borderTop: "0.5px solid #f0f0f0" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 20, marginTop: 16 }}>

                        {/* Ingredients */}
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: "#333" }}>Ingredients</div>
                          {recipe.ingredients.map((ing, i) => (
                            <div key={i} style={{ padding: "6px 0", borderBottom: "0.5px solid #f5f5f5", fontSize: 13 }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#333" }}>{ing.item}</span>
                                <span style={{ color: "#888", fontWeight: 500, marginLeft: 8, whiteSpace: "nowrap" }}>{ing.quantity}</span>
                              </div>
                              {ing.note && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{ing.note}</div>}
                            </div>
                          ))}
                        </div>

                        {/* Steps */}
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: "#333" }}>Instructions</div>
                          {recipe.steps.map((step, i) => (
                            <div key={i} style={{ marginBottom: 16 }}>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#111", color: "#fff", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                                  {step.step}
                                </span>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>{step.title}</div>
                                  <div style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{step.instruction}</div>
                                  {step.tip && (
                                    <div style={{ fontSize: 12, color: "#BA7517", background: "#FAEEDA", padding: "6px 10px", borderRadius: 6, marginTop: 6, lineHeight: 1.5 }}>
                                      💡 {step.tip}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Chef tips */}
                      {recipe.chefTips?.length > 0 && (
                        <div style={{ marginTop: 16, background: "#f8f8f8", borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "#555", marginBottom: 8 }}>CHEF'S TIPS</div>
                          {recipe.chefTips.map((tip, i) => (
                            <div key={i} style={{ fontSize: 13, color: "#444", padding: "4px 0", display: "flex", gap: 8, lineHeight: 1.5 }}>
                              <span style={{ color: "#1D9E75", flexShrink: 0 }}>✓</span>
                              {tip}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── FEEDBACK TAB ── */}
      {tab === "feedback" && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>Rate this week's meals</div>
          <div style={{ fontSize: 13, color: "#999", marginBottom: 16 }}>Ratings shape future menus. Meals rated 9+/10 combined average are eligible to repeat once per month.</div>
          {plan ? (
            <div style={card}>
              {(["monday","tuesday","wednesday","thursday","friday"] as const).map((day, i, arr) => {
                const meal = (plan as any)[day] as Meal;
                if (!meal || meal.name === "Leftovers") return null;
                const r = ratings[meal.name];
                const combined = r ? (r.adultAvg + r.kidAvg) / 2 : 0;
                return (
                  <div key={day} style={{ padding: "14px 0", borderBottom: i < arr.length - 1 ? "0.5px solid #f5f5f5" : "none" }}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{meal.name}</div>
                    <div style={{ fontSize: 12, color: "#aaa", marginBottom: 10 }}>{meal.description}</div>
                    <StarRow meal={meal.name} field="adultAvg" label="Adult average rating" />
                    <StarRow meal={meal.name} field="kidAvg" label="Kid average rating" />
                    {r && r.adultAvg > 0 && r.kidAvg > 0 && (
                      <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                        Combined average: {combined.toFixed(1)}/10
                        {combined >= 9 && <span style={{ color: "#1D9E75", marginLeft: 8 }}>★ Highly rated — eligible to repeat next month</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={noticeStyle("blue")}>Generate your first meal plan to unlock meal ratings.</div>
          )}
          <div style={{ fontSize: 15, fontWeight: 500, margin: "20px 0 12px" }}>Notes for next week</div>
          <div style={card}>
            <label style={{ fontSize: 12, color: "#999" }}>What did your family think? What do you want more or less of?</label>
            <textarea style={{ width: "100%", fontSize: 13, padding: "8px 10px", border: "0.5px solid #ddd", borderRadius: 8, marginTop: 4, minHeight: 70, resize: "vertical", boxSizing: "border-box" }}
              value={newFeedback} onChange={e => setNewFeedback(e.target.value)}
              placeholder="e.g. The tacos were a huge hit, want more pasta nights, kids didn't love the salmon..." />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={btnP} onClick={saveFeedback} disabled={!newFeedback.trim()}>Save feedback & log this week</button>
            </div>
          </div>
          {feedback.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Saved preferences</div>
              {feedback.slice(-8).map((f, i) => (
                <div key={i} style={{ fontSize: 13, color: "#444", padding: "5px 0", borderBottom: "0.5px solid #f5f5f5", lineHeight: 1.6 }}>{f}</div>
              ))}
            </div>
          )}
          {mealHistory.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Meal history</div>
              {mealHistory.slice(-20).reverse().map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "0.5px solid #f5f5f5" }}>
                  <span style={{ color: "#333" }}>{m.name}</span>
                  <span style={{ color: "#999", fontSize: 12 }}>{m.weekOf}{m.adultRating ? ` · Adults: ${m.adultRating}/10` : ""}{m.kidRating ? ` · Kids: ${m.kidRating}/10` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === "settings" && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>API credentials</div>
          <div style={noticeStyle("blue")}>All credentials stored only in your browser's local storage — never sent anywhere except directly to the respective APIs through your private server.</div>
          <div style={card}>
            {[
              ["Claude API Key", claudeKey, setClaudeKey, "password", "sk-ant-..."],
              ["Kroger Client ID", clientId, setClientId, "text", "georgesmealplanner-xxxx"],
              ["Kroger Client Secret", clientSecret, setClientSecret, "password", "••••••••••••••••"],
              ["King Soopers store zip code", storeZip, setStoreZip, "text", "e.g. 80220"],
              ["Default weekly budget ($)", budgetInput, setBudgetInput, "number", "150"],
            ].map(([label, val, setter, type, placeholder]) => (
              <div key={label as string} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: "#999" }}>{label as string}</label>
                <input style={input} type={type as string} value={val as string}
                  onChange={e => (setter as any)(e.target.value)} placeholder={placeholder as string} />
              </div>
            ))}
            <button style={btnP} onClick={saveSettings}>Save all settings</button>
            {settingsSaved && <div style={{ fontSize: 12, color: "#0F6E56", marginTop: 8 }}>✓ Settings saved</div>}
            {storeInfo && <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>Store: {storeInfo.name} — {storeInfo.address}</div>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, margin: "20px 0 12px" }}>Household settings</div>
          <div style={card}>
            {[
              ["Household size", "5 people (2 adults, 2 kids ages 12 & 6, 1 adult)"],
              ["Quick meal nights", "Tuesday & Thursday (under 30 min)"],
              ["Leftover nights", "Saturday & Sunday"],
              ["Meal repeat policy", "No repeats within 4 weeks; 9+/10 combined rating eligible once/month"],
              ["Dietary rules", "Kid-friendly, no hard restrictions"],
              ["Location", "Denver, CO — 8.81% combined sales tax"],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, borderBottom: "0.5px solid #f5f5f5", gap: 16 }}>
                <span style={{ color: "#999", flexShrink: 0 }}>{label}</span>
                <span style={{ color: "#333", textAlign: "right" }}>{val}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, margin: "20px 0 12px" }}>Tax reference</div>
          <div style={card}>
            {[
              ["Denver combined sales tax", "8.81%"],
              ["Meat, produce, dairy, bread, frozen foods", "Non-taxable"],
              ["Soft drinks, candy, alcohol, prepared foods", "Taxable"],
              ["Paper goods, cleaning supplies, personal care", "Taxable"],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 13, borderBottom: "0.5px solid #f5f5f5" }}>
                <span style={{ color: "#666" }}>{label}</span>
                <span style={{ color: "#333", fontWeight: 500 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
