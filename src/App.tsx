import { useState, useEffect } from "react";

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

// ── Keep-alive ping ───────────────────────────────────────────────────────────
function useKeepAlive() {
  useEffect(() => {
    const ping = () => fetch(`${SERVER}/api/health`).catch(() => {});
    ping();
    const interval = setInterval(ping, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
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
  useKeepAlive();

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
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [cartStatus, setCartStatus] = useState("");
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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

      setStatus("Step 2 of 2 — Generating detailed recipes...");

      const buildRecipePrompt = (meals: { day: string; meal: Meal; isQuick: boolean }[]) => `
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

    setFeedbackSaved(true);
    setTimeout(() => setFeedbackSaved(false), 3000);
  }

  function resetAllData() {
    Object.values(KEYS).forEach(k => {
      if (k !== KEYS.clientId && k !== KEYS.clientSecret && k !== KEYS.claudeKey && k !== KEYS.storeZip) {
        localStorage.removeItem(k);
      }
    });
    setPlan(null);
    setRecipes([]);
    setGroceries(null);
    setFeedback([]);
    setRatings({});
    setMealHistory([]);
    setStatus("");
    setShowResetConfirm(false);
    setTab("plan");
  }

  function StarRow({ meal, field, label }: { meal: string; field: "adultAvg" | "kidAvg"; label: string }) {
    const current = ratings[meal]?.[field] || 0;
    const color = current >= 9 ? "#1D9E75" : current >= 6 ? "#BA7517" : current > 0 ? "#D85A30" : "#e0e0e0";
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{label}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {[1,2,3,4,5,6,7,8,9,10].map(n => (
            <button key={n} onClick={() => setRating(meal, field, n)}
              style={{ fontSize: 22, background: "none", border: "none", cursor: "pointer", color: n <= current ? color : "#e0e0e0", padding: "4px 2px", minWidth: 28, minHeight: 44 }}>★</button>
          ))}
          {current > 0 && <span style={{ fontSize: 13, color: "#999", marginLeft: 4 }}>{current}/10</span>}
        </div>
      </div>
    );
  }

  const badge = (type: string): React.CSSProperties => (({
    quick:    { background: "#E1F5EE", color: "#0F6E56", padding: "3px 10px", borderRadius: 20, fontSize: 12, whiteSpace: "nowrap" as const },
    leftover: { background: "#FAEEDA", color: "#854F0B", padding: "3px 10px", borderRadius: 20, fontSize: 12, whiteSpace: "nowrap" as const },
    main:     { background: "#E6F1FB", color: "#185FA5", padding: "3px 10px", borderRadius: 20, fontSize: 12, whiteSpace: "nowrap" as const },
  } as any)[type] || { background: "#E6F1FB", color: "#185FA5", padding: "3px 10px", borderRadius: 20, fontSize: 12 });

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: "10px 14px", fontSize: 13, cursor: "pointer", border: "none", background: "none",
    color: tab === t ? "#111" : "#999", borderBottom: tab === t ? "2px solid #111" : "2px solid transparent",
    fontWeight: tab === t ? 500 : 400, marginBottom: -1, whiteSpace: "nowrap",
  });

  const btnP: React.CSSProperties = { padding: "12px 20px", fontSize: 14, border: "none", borderRadius: 10, background: "#111", color: "#fff", cursor: "pointer", minHeight: 44 };
  const btnS: React.CSSProperties = { padding: "12px 20px", fontSize: 14, border: "0.5px solid #ccc", borderRadius: 10, background: "none", cursor: "pointer", color: "#333", minHeight: 44 };
  const btnG: React.CSSProperties = { padding: "12px 20px", fontSize: 14, border: "none", borderRadius: 10, background: "#1D9E75", color: "#fff", cursor: "pointer", minHeight: 44 };
  const btnR: React.CSSProperties = { padding: "12px 20px", fontSize: 14, border: "none", borderRadius: 10, background: "#D85A30", color: "#fff", cursor: "pointer", minHeight: 44 };
  const card: React.CSSProperties = { background: "#fff", border: "0.5px solid #e8e8e8", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: 12 };
  const input: React.CSSProperties = { width: "100%", fontSize: 15, padding: "12px 12px", border: "0.5px solid #ddd", borderRadius: 10, marginTop: 6, boxSizing: "border-box", minHeight: 44 };
  const noticeStyle = (color: string): React.CSSProperties => ({
    background: color === "blue" ? "#f0f7ff" : color === "green" ? "#E1F5EE" : "#FFF3E0",
    borderLeft: `3px solid ${color === "blue" ? "#378ADD" : color === "green" ? "#1D9E75" : "#BA7517"}`,
    borderRadius: 8, padding: "0.75rem 1rem", fontSize: 14,
    color: color === "blue" ? "#444" : color === "green" ? "#0F4A30" : "#6D3F00", marginBottom: 12,
  });

  return (
    <div style={{ fontFamily: "system-ui,sans-serif", maxWidth: 680, margin: "0 auto", padding: "1rem" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 2, color: "#111" }}>Georges Meal Planner</h1>
        <p style={{ fontSize: 13, color: "#999" }}>5 people · King Soopers · Denver, CO</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e8e8e8", marginBottom: 20, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[["plan","Plan"],["groceries","Groceries"],["recipes","Recipes"],["feedback","Ratings"],["settings","Setup"]].map(([t, label]) => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {/* ── PLAN TAB ── */}
      {tab === "plan" && (
        <div>
          {/* Budget */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "12px 14px", background: "#f8f8f8", borderRadius: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: "#555" }}>Weekly budget:</span>
            <span style={{ fontWeight: 500, fontSize: 16 }}>$</span>
            <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)}
              onBlur={() => { const b = parseFloat(budgetInput) || DEFAULT_BUDGET; setBudget(b); lsSet(KEYS.budget, JSON.stringify(b)); }}
              style={{ width: 90, fontSize: 18, fontWeight: 600, padding: "6px 8px", border: "0.5px solid #ddd", borderRadius: 8, textAlign: "center", minHeight: 44 }} />
          </div>

          {/* Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              ["Est. total", totals ? `$${totals.grand.toFixed(2)}` : "—", totals?.overBudget ? "#D85A30" : "#111"],
              ["Budget", `$${budget}`, "#111"],
              ["Remaining", totals ? `$${(budget - totals.grand).toFixed(2)}` : "—", totals ? (totals.overBudget ? "#D85A30" : "#1D9E75") : "#111"],
            ].map(([label, val, color]) => (
              <div key={label as string} style={{ background: "#f8f8f8", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>{label as string}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: color as string }}>{val as string}</div>
              </div>
            ))}
          </div>

          {/* Add-ons panel */}
          {showAddons && (
            <div style={{ ...card, border: "1.5px solid #378ADD", background: "#f9fcff", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Before we fetch prices...</div>
              <div style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>Want to add any extra items to your trip?</div>
              {COMMON_ADDONS.map(group => (
                <div key={group.category} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>{group.category}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    {group.items.map(item => (
                      <label key={item} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "8px 4px", cursor: "pointer", color: "#333", minHeight: 44 }}>
                        <span style={{
  width: 22, height: 22, borderRadius: 6, border: checkedAddons.includes(item) ? "none" : "2px solid #ccc",
  background: checkedAddons.includes(item) ? "#378ADD" : "#fff",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0, transition: "all 0.15s"
}}>
  {checkedAddons.includes(item) && <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>✓</span>}
</span>
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "0.5px solid #e8e8e8", paddingTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Anything else?</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...input, marginTop: 0, flex: 1 }} type="text" value={customAddon}
                    onChange={e => setCustomAddon(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addCustomAddon()}
                    placeholder="Type item and press Enter" />
                  <button style={{ ...btnS, padding: "12px 16px" }} onClick={addCustomAddon}>Add</button>
                </div>
                {customAddonList.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {customAddonList.map(item => (
                      <span key={item} style={{ background: "#E6F1FB", color: "#185FA5", fontSize: 13, padding: "4px 12px", borderRadius: 20, display: "flex", alignItems: "center", gap: 6 }}>
                        {item}
                        <button onClick={() => setCustomAddonList(customAddonList.filter(i => i !== item))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#185FA5", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <button style={btnG} onClick={confirmAddons}>
                  {checkedAddons.length + customAddonList.length > 0
                    ? `Add ${checkedAddons.length + customAddonList.length} item(s) & fetch prices`
                    : "No extras — fetch prices"}
                </button>
                <button style={btnS} onClick={() => setShowAddons(false)}>Skip</button>
              </div>
            </div>
          )}

          {/* Meal plan */}
          <div style={card}>
            {DAYS.map((d, i) => (
              <div key={d.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 0", borderBottom: i < DAYS.length - 1 ? "0.5px solid #f5f5f5" : "none", gap: 10 }}>
                <div style={{ minWidth: 90 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>{d.type === "quick" ? "Quick meal" : d.type === "leftover" ? "Leftovers" : "Main cook"}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{(plan as any)?.[d.key]?.name || "—"}</div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 3, lineHeight: 1.4 }}>
                    {(plan as any)?.[d.key]?.description || (d.type === "leftover" ? "Leftovers" : "Generate a plan")}
                    {(plan as any)?.[d.key]?.doubled && <span style={{ display: "block", fontSize: 11, color: "#0F6E56", marginTop: 2 }}>↑ doubled for leftovers</span>}
                  </div>
                  {d.type !== "leftover" && recipes.find(r => r.day === d.key) && (
                    <button onClick={() => { setTab("recipes"); setExpandedRecipe((plan as any)?.[d.key]?.name); }}
                      style={{ fontSize: 12, color: "#378ADD", background: "none", border: "none", cursor: "pointer", padding: "4px 0 0 0", minHeight: 32 }}>
                      view recipe →
                    </button>
                  )}
                </div>
                <span style={badge(d.type)}>{d.type}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
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
            <div style={{ fontSize: 13, color: "#555", padding: "10px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1D9E75", display: "inline-block", flexShrink: 0 }} />
              {status}
            </div>
          )}
        </div>
      )}

      {/* ── GROCERIES TAB ── */}
      {tab === "groceries" && (
        <div>
          {!groceries ? (
            <div style={noticeStyle("blue")}>Generate a meal plan first to see your grocery list with live King Soopers pricing.</div>
          ) : (
            <>
              {totals?.overBudget && <div style={noticeStyle("orange")}>⚠ ${totals.grand.toFixed(2)} is ${(totals.grand - budget).toFixed(2)} over your ${budget} budget.</div>}
              {totals && !totals.overBudget && <div style={noticeStyle("green")}>✓ Within budget! ${totals.grand.toFixed(2)} of ${budget}.</div>}
              <div style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>{groceries.store} · {groceries.fetchedAt} · <span style={{ color: "#BA7517" }}>●</span> = taxable</div>

              {(() => {
                const grouped: Record<string, GroceryItem[]> = {};
                groceries.items.forEach(i => { const c = i.category || "Other"; if (!grouped[c]) grouped[c] = []; grouped[c].push(i); });
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(grouped).map(([cat, items]) => (
                      <div key={cat} style={card}>
                        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10, paddingBottom: 8, borderBottom: "0.5px solid #f0f0f0", textTransform: "capitalize" }}>{cat}</div>
                        {items.map((item, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", fontSize: 14, borderBottom: "0.5px solid #f5f5f5", gap: 8 }}>
                            <span style={{ color: "#333", flex: 1 }}>
                              {item.krogerName || item.item}
                              <span style={{ fontSize: 12, color: "#bbb", marginLeft: 4 }}>({item.quantity})</span>
                              {item.taxable && <span style={{ color: "#BA7517", marginLeft: 4, fontSize: 12 }}>●</span>}
                            </span>
                            <span style={{ color: "#999", fontSize: 13, whiteSpace: "nowrap", fontWeight: 500 }}>
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
                    ["Taxable items", `$${totals.taxable.toFixed(2)}`, false, false],
                    ["Denver sales tax (8.81%)", `$${totals.tax.toFixed(2)}`, false, false],
                    ["Estimated total", `$${totals.grand.toFixed(2)}`, true, false],
                    ["Weekly budget", `$${budget.toFixed(2)}`, false, false],
                    [totals.overBudget ? "Over budget by" : "Under budget by", `$${Math.abs(budget - totals.grand).toFixed(2)}`, false, totals.overBudget],
                  ].map(([label, val, bold, danger]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: bold ? 16 : 14, fontWeight: bold ? 600 : 400, borderBottom: "0.5px solid #f5f5f5", color: bold ? "#111" : "#666" }}>
                      <span>{label as string}</span>
                      <span style={{ color: danger ? "#D85A30" : label === "Under budget by" ? "#1D9E75" : "inherit" }}>{val as string}</span>
                    </div>
                  ))}
                  {totals.missing > 0 && (
                    <div style={{ background: "#FFF3E0", borderLeft: "3px solid #BA7517", borderRadius: 8, padding: "10px 14px", marginTop: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "#6D3F00" }}>⚠ Estimated low — {totals.missing} item(s) have no price</div>
                      <div style={{ fontSize: 13, color: "#854F0B", marginTop: 4 }}>Your actual total at checkout will be higher. Items marked with — had no price found.</div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button style={btnP} onClick={() => setCartStatus("Cart integration requires King Soopers account authorization (OAuth). Coming soon — your list is ready to reference while you shop!")}>
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
            <div style={noticeStyle("blue")}>Generate a meal plan first — recipes for all 5 meals appear here automatically.</div>
          ) : (
            recipes.map(recipe => {
              const isExpanded = expandedRecipe === recipe.mealName;
              return (
                <div key={recipe.mealName} style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <div onClick={() => setExpandedRecipe(isExpanded ? null : recipe.mealName)}
                    style={{ padding: "1rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: isExpanded ? "#fafafa" : "#fff", minHeight: 60 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{recipe.mealName}</span>
                        {recipe.isQuick && <span style={{ background: "#E1F5EE", color: "#0F6E56", padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>quick</span>}
                        {recipe.isDoubled && <span style={{ background: "#E6F1FB", color: "#185FA5", padding: "2px 8px", borderRadius: 20, fontSize: 11 }}>doubled</span>}
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#999", flexWrap: "wrap" }}>
                        <span>Prep: {recipe.prepTime}</span>
                        <span>Cook: {recipe.cookTime}</span>
                        <span>Total: {recipe.totalTime}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 20, color: "#ccc", marginLeft: 12 }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: "0 1rem 1rem", borderTop: "0.5px solid #f0f0f0" }}>
                      <div style={{ fontSize: 13, color: "#999", margin: "12px 0 16px" }}>{recipe.servings}</div>

                      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Ingredients</div>
                      {recipe.ingredients.map((ing, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14, borderBottom: "0.5px solid #f5f5f5", gap: 8 }}>
                          <div>
                            <span style={{ color: "#333" }}>{ing.item}</span>
                            {ing.note && <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{ing.note}</div>}
                          </div>
                          <span style={{ color: "#888", fontWeight: 500, whiteSpace: "nowrap" }}>{ing.quantity}</span>
                        </div>
                      ))}

                      <div style={{ fontSize: 14, fontWeight: 500, margin: "20px 0 10px" }}>Instructions</div>
                      {recipe.steps.map((step, i) => (
                        <div key={i} style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
                          <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#111", color: "#fff", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                            {step.step}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{step.title}</div>
                            <div style={{ fontSize: 14, color: "#444", lineHeight: 1.6 }}>{step.instruction}</div>
                            {step.tip && (
                              <div style={{ fontSize: 13, color: "#BA7517", background: "#FAEEDA", padding: "8px 12px", borderRadius: 8, marginTop: 8, lineHeight: 1.5 }}>
                                💡 {step.tip}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}

                      {recipe.chefTips?.length > 0 && (
                        <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "14px", marginTop: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Chef's tips</div>
                          {recipe.chefTips.map((tip, i) => (
                            <div key={i} style={{ fontSize: 14, color: "#444", padding: "5px 0", display: "flex", gap: 10, lineHeight: 1.5 }}>
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
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Rate this week's meals</div>
          <div style={{ fontSize: 13, color: "#999", marginBottom: 16, lineHeight: 1.5 }}>Ratings shape future menus. 9+/10 combined average meals are eligible to repeat once per month.</div>

          {plan ? (
            <div style={card}>
              {(["monday","tuesday","wednesday","thursday","friday"] as const).map((day, i, arr) => {
                const meal = (plan as any)[day] as Meal;
                if (!meal || meal.name === "Leftovers") return null;
                const r = ratings[meal.name];
                const combined = r ? (r.adultAvg + r.kidAvg) / 2 : 0;
                return (
                  <div key={day} style={{ padding: "16px 0", borderBottom: i < arr.length - 1 ? "0.5px solid #f5f5f5" : "none" }}>
                    <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>{meal.name}</div>
                    <div style={{ fontSize: 13, color: "#aaa", marginBottom: 12 }}>{meal.description}</div>
                    <StarRow meal={meal.name} field="adultAvg" label="Adult average rating" />
                    <StarRow meal={meal.name} field="kidAvg" label="Kid average rating" />
                    {r && r.adultAvg > 0 && r.kidAvg > 0 && (
                      <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>
                        Combined: {combined.toFixed(1)}/10
                        {combined >= 9 && <span style={{ color: "#1D9E75", marginLeft: 8 }}>★ Eligible to repeat next month</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={noticeStyle("blue")}>Generate your first meal plan to unlock ratings.</div>
          )}

          <div style={{ fontSize: 16, fontWeight: 500, margin: "20px 0 12px" }}>Notes for next week</div>
          <div style={card}>
            <label style={{ fontSize: 13, color: "#999" }}>What did your family think? What do you want more or less of?</label>
            <textarea style={{ width: "100%", fontSize: 14, padding: "12px", border: "0.5px solid #ddd", borderRadius: 10, marginTop: 8, minHeight: 90, resize: "vertical", boxSizing: "border-box", lineHeight: 1.5 }}
              value={newFeedback} onChange={e => setNewFeedback(e.target.value)}
              placeholder="e.g. The tacos were a huge hit, want more pasta nights, kids didn't love the salmon..." />
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button style={btnP} onClick={saveFeedback} disabled={!newFeedback.trim()}>Save feedback & log this week</button>
            </div>
            {feedbackSaved && <div style={{ fontSize: 13, color: "#0F6E56", marginTop: 8 }}>✓ Feedback saved! It will shape next week's menu.</div>}
          </div>

          {feedback.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Saved preferences</div>
              {feedback.slice(-8).map((f, i) => (
                <div key={i} style={{ fontSize: 14, color: "#444", padding: "8px 0", borderBottom: "0.5px solid #f5f5f5", lineHeight: 1.6 }}>{f}</div>
              ))}
            </div>
          )}

          {mealHistory.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Meal history</div>
              {mealHistory.slice(-20).reverse().map((m, i) => (
                <div key={i} style={{ fontSize: 14, padding: "8px 0", borderBottom: "0.5px solid #f5f5f5" }}>
                  <div style={{ color: "#333" }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: "#999", marginTop: 2 }}>{m.weekOf}{m.adultRating ? ` · Adults: ${m.adultRating}/10` : ""}{m.kidRating ? ` · Kids: ${m.kidRating}/10` : ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === "settings" && (
        <div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>API credentials</div>
          <div style={noticeStyle("blue")}>Credentials stored only in your browser — never sent anywhere except directly to the APIs.</div>
          <div style={card}>
            {[
              ["Claude API Key", claudeKey, setClaudeKey, "password", "sk-ant-..."],
              ["Kroger Client ID", clientId, setClientId, "text", "georgesmealplanner-xxxx"],
              ["Kroger Client Secret", clientSecret, setClientSecret, "password", "••••••••••••••••"],
              ["King Soopers store zip code", storeZip, setStoreZip, "text", "e.g. 80220"],
              ["Default weekly budget ($)", budgetInput, setBudgetInput, "number", "150"],
            ].map(([label, val, setter, type, placeholder]) => (
              <div key={label as string} style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 4 }}>{label as string}</label>
                <input style={input} type={type as string} value={val as string}
                  onChange={e => (setter as any)(e.target.value)} placeholder={placeholder as string} />
              </div>
            ))}
            <button style={btnP} onClick={saveSettings}>Save all settings</button>
            {settingsSaved && <div style={{ fontSize: 13, color: "#0F6E56", marginTop: 10 }}>✓ Settings saved</div>}
            {storeInfo && <div style={{ fontSize: 13, color: "#555", marginTop: 10 }}>Store: {storeInfo.name} — {storeInfo.address}</div>}
          </div>

          <div style={{ fontSize: 16, fontWeight: 500, margin: "24px 0 12px" }}>Household settings</div>
          <div style={card}>
            {[
              ["Household size", "5 people (2 adults, 2 kids ages 12 & 6, 1 adult)"],
              ["Quick meal nights", "Tuesday & Thursday (under 30 min)"],
              ["Leftover nights", "Saturday & Sunday"],
              ["Meal repeat policy", "No repeats within 4 weeks; 9+/10 eligible once/month"],
              ["Dietary rules", "Kid-friendly, no hard restrictions"],
              ["Location", "Denver, CO — 8.81% combined sales tax"],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, borderBottom: "0.5px solid #f5f5f5", gap: 12 }}>
                <span style={{ color: "#999", flexShrink: 0 }}>{label}</span>
                <span style={{ color: "#333", textAlign: "right" }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 16, fontWeight: 500, margin: "24px 0 12px" }}>Tax reference</div>
          <div style={card}>
            {[
              ["Denver combined sales tax", "8.81%"],
              ["Meat, produce, dairy, bread, frozen foods", "Non-taxable"],
              ["Soft drinks, candy, alcohol, prepared foods", "Taxable"],
              ["Paper goods, cleaning supplies, personal care", "Taxable"],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14, borderBottom: "0.5px solid #f5f5f5" }}>
                <span style={{ color: "#666" }}>{label}</span>
                <span style={{ color: "#333", fontWeight: 500 }}>{val}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 16, fontWeight: 500, margin: "24px 0 12px" }}>Reset app data</div>
          <div style={card}>
            <div style={{ fontSize: 14, color: "#666", marginBottom: 12, lineHeight: 1.6 }}>
              Clears all meal plans, grocery lists, recipes, ratings, feedback, and meal history. Your API credentials and settings are preserved.
            </div>
            {!showResetConfirm ? (
              <button style={btnR} onClick={() => setShowResetConfirm(true)}>Reset all app data</button>
            ) : (
              <div>
                <div style={{ fontSize: 14, color: "#D85A30", marginBottom: 12, fontWeight: 500 }}>Are you sure? This cannot be undone.</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={btnR} onClick={resetAllData}>Yes, reset everything</button>
                  <button style={btnS} onClick={() => setShowResetConfirm(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
