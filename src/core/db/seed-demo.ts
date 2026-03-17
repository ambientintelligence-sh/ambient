/**
 * Shared seed module: populates the Ambient DB with demo data for onboarding.
 * Used by both `scripts/seed-demo.ts` (dev convenience) and auto-seed on first launch.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Session IDs (deterministic so agents can reference tasks)
// ---------------------------------------------------------------------------
export const MEETING_SESSION_ID = "demo-meeting-session";
export const TRIP_SESSION_ID = "demo-trip-session";
export const BRAIN_SESSION_ID = "demo-brain-session";
export const STUDY_SESSION_ID = "demo-study-session";
export const PM_SESSION_ID = "demo-pm-session";

// Deterministic task IDs for MEETING session (agents reference these)
const MEETING_TASK_IDS = {
  oauth: "meeting-task-oauth",
  dashboardPerf: "meeting-task-dashboard-perf",
  stripeInvoicing: "meeting-task-stripe-invoicing",
  migrationGuide: "meeting-task-migration-guide",
  datadog: "meeting-task-datadog",
  webhookAlerting: "meeting-task-webhook-alerting",
  postmortem: "meeting-task-postmortem",
  datadogPricing: "meeting-task-datadog-pricing",
} as const;

// Deterministic task ID for TRIP session (agent references this)
const TRIP_TASK_IDS = {
  itinerary: "trip-task-itinerary",
  flights: "trip-task-flights",
  ryokan: "trip-task-ryokan",
  visa: "trip-task-visa",
} as const;

// Deterministic task IDs for BRAIN session (agents reference these)
const BRAIN_TASK_IDS = {
  prototype: "brain-task-prototype",
  interviews: "brain-task-interviews",
  domains: "brain-task-domains",
  spoonacular: "brain-task-spoonacular",
} as const;

// Deterministic task IDs for STUDY session (agent references this)
const STUDY_TASK_IDS = {
  comparison: "study-task-comparison",
  practice: "study-task-practice",
  bft: "study-task-bft",
  uncommitted: "study-task-uncommitted",
} as const;

// Deterministic task IDs for PM session (agents reference these)
const PM_TASK_IDS = {
  linearIssues: "pm-task-linear-issues",
  preferencesApi: "pm-task-preferences-api",
  batchingEngine: "pm-task-batching-engine",
  preferencesUi: "pm-task-preferences-ui",
  digestDesign: "pm-task-digest-design",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type BlockSeed = {
  sourceText: string;
  translation?: string;
  audioSource: "system" | "mic";
  newTopic?: boolean;
};

type InsightSeed = { text: string };
type TaskSeed = {
  id?: string;
  text: string;
  details?: string;
  size: "small" | "large";
  source: "ai" | "manual";
  completed?: boolean;
  completedAt?: number;
};

type AgentStepSeed = {
  id: string;
  kind: "thinking" | "tool-call" | "tool-result" | "text" | "user" | "plan" | "todo";
  content: string;
  toolName?: string;
  toolInput?: string;
  approvalState?: string;
  planTitle?: string;
  planContent?: string;
  planApprovalState?: "awaiting-approval" | "approved" | "rejected";
  todoItems?: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" | "cancelled" }>;
  createdAt: number;
};

type AgentSeed = {
  id: string;
  kind: "analysis" | "custom";
  taskId: string;
  sessionId: string;
  task: string;
  taskContext?: string;
  status: "running" | "completed" | "failed";
  result?: string;
  steps: AgentStepSeed[];
  createdAt: number;
  completedAt?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function insertSession(
  db: Database.Database,
  id: string,
  title: string,
  startedAt: number,
  endedAt: number,
  blockCount: number,
  sourceLang = "en",
  targetLang = "",
) {
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, started_at, ended_at, title, block_count, source_lang, target_lang)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, startedAt, endedAt, title, blockCount, sourceLang, targetLang);
}

function updateSession(db: Database.Database, id: string, endedAt: number, blockCount: number) {
  db.prepare("UPDATE sessions SET ended_at = ?, block_count = ? WHERE id = ?").run(endedAt, blockCount, id);
}

function insertBlocks(
  db: Database.Database,
  sessionId: string,
  seeds: BlockSeed[],
  startTs: number,
  gapMs: [number, number],
  sourceLabel: string,
  targetLabel: string,
) {
  const stmt = db.prepare(`
    INSERT INTO blocks (session_id, source_label, source_text, target_label, translation, audio_source, partial, new_topic, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  let ts = startTs;
  for (const seed of seeds) {
    stmt.run(
      sessionId,
      sourceLabel,
      seed.sourceText,
      targetLabel,
      seed.translation ?? null,
      seed.audioSource,
      seed.newTopic ? 1 : 0,
      ts,
    );
    ts += gapMs[0] + Math.floor(Math.random() * (gapMs[1] - gapMs[0]));
  }
  return ts;
}

function insertInsights(db: Database.Database, sessionId: string, seeds: InsightSeed[], startTs: number, gapMs: number) {
  const stmt = db.prepare(`
    INSERT INTO insights (id, kind, text, session_id, created_at)
    VALUES (?, 'key-point', ?, ?, ?)
  `);
  let ts = startTs;
  for (const seed of seeds) {
    stmt.run(randomUUID(), seed.text, sessionId, ts);
    ts += gapMs;
  }
}

function insertTasks(db: Database.Database, sessionId: string, seeds: TaskSeed[], startTs: number, gapMs: number) {
  const stmt = db.prepare(`
    INSERT INTO tasks (id, text, details, size, completed, source, created_at, completed_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let ts = startTs;
  for (const seed of seeds) {
    stmt.run(
      seed.id ?? randomUUID(),
      seed.text,
      seed.details ?? null,
      seed.size,
      seed.completed ? 1 : 0,
      seed.source,
      ts,
      seed.completedAt ?? null,
      sessionId,
    );
    ts += gapMs;
  }
}

function insertAgent(db: Database.Database, agent: AgentSeed) {
  db.prepare(`
    INSERT INTO agents (id, kind, task_id, session_id, task, task_context, status, result, steps, created_at, completed_at, archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    agent.id,
    agent.kind,
    agent.taskId,
    agent.sessionId,
    agent.task,
    agent.taskContext ?? null,
    agent.status,
    agent.result ?? null,
    JSON.stringify(agent.steps),
    agent.createdAt,
    agent.completedAt ?? null,
  );
}

function updateSessionSummary(
  db: Database.Database,
  sessionId: string,
  summaryData: string,
  narrative: string,
  actionItems: string,
  generatedAt: number,
) {
  db.prepare(`
    UPDATE sessions
    SET summary_data = ?, summary_narrative = ?, summary_action_items = ?, summary_generated_at = ?
    WHERE id = ?
  `).run(summaryData, narrative, actionItems, generatedAt, sessionId);
}

function updateSessionAgentsSummary(
  db: Database.Database,
  sessionId: string,
  agentsSummaryData: string,
  generatedAt: number,
) {
  db.prepare(`
    UPDATE sessions SET agents_summary_data = ?, agents_summary_generated_at = ? WHERE id = ?
  `).run(agentsSummaryData, generatedAt, sessionId);
}

// ===========================================================================
// TRANSCRIPT DATA (same as original seed script)
// ===========================================================================

const TRIP_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay so Japan. Cherry blossom season. We're actually doing this? Like for real this time, not like the Portugal thing where we talked about it for six months and then nobody booked anything.", audioSource: "system", newTopic: true },
  { sourceText: "Yes, we're doing it. I already started looking at dates. Peak bloom in Tokyo is usually late March to early April, but it shifts year to year. The Japan Meteorological Corporation puts out forecasts starting in January.", audioSource: "mic" },
  { sourceText: "Wait who's all confirmed? It's me, you, Danny, and Priya right?", audioSource: "system" },
  { sourceText: "Priya said she's in but she needs to check something with her visa. She's on that H-1B so she might need to do the advance parole thing.", audioSource: "mic" },
  { sourceText: "Oh right. Priya can you look into that this week? I don't want a repeat of the Cancun situation.", audioSource: "system" },
  { sourceText: "Yeah I'll call my immigration lawyer Monday. Should be fine, I've traveled internationally twice this year already. But I need like three weeks lead time on the paperwork.", audioSource: "system" },
  { sourceText: "Okay so dates. I'm looking at my calendar and basically all of April works for me except the first week, I have a product launch at work.", audioSource: "mic", newTopic: true },
  { sourceText: "Danny what about you? You said something about a wedding?", audioSource: "system" },
  { sourceText: "Yeah my cousin's wedding is April 26th so I need to be back by then. But April 5th through like the 18th? That's thirteen days and I could swing it.", audioSource: "system" },
  { sourceText: "Thirteen days is kinda long for me honestly. Can we do ten? Like April 5th to the 15th?", audioSource: "mic" },
  { sourceText: "I could do April 5th to 15th. Priya?", audioSource: "system" },
  { sourceText: "Works for me assuming the visa stuff is sorted. Let's pencil that in and I'll confirm by end of next week.", audioSource: "system" },
  { sourceText: "Okay cool. April 5 to 15. Eleven days. That's actually perfect because we can do like five days Tokyo, three days Kyoto, two days Hakone or Osaka, and a travel day.", audioSource: "mic", translation: "いいね。4月5日から15日。11日間。東京5日、京都3日、箱根か大阪2日、移動日1日でちょうどいい感じ。" },
  { sourceText: "Alright flights. I've been stalking Google Flights for like two weeks now so I have opinions.", audioSource: "system", newTopic: true },
  { sourceText: "Of course you do, go ahead.", audioSource: "mic" },
  { sourceText: "So from SFO to Narita or Haneda. ANA direct is running about $920 round trip right now for those dates. JAL is similar, maybe $890. Then there's Zipair which is like $640 but it's budget — no meals, no checked bags, the seats are tighter.", audioSource: "system", translation: "SFOから成田か羽田行き。ANAの直行便が今往復920ドルくらい。JALも同じくらいで890ドルかな。あとZipairが640ドルだけどLCCだから機内食なし、受託手荷物なし、座席も狭い。" },
  { sourceText: "What about United? They fly direct to Narita too.", audioSource: "mic" },
  { sourceText: "United is like $780 but honestly ANA is so much better for transpacific. The food alone is worth the extra hundred bucks. And you get two checked bags.", audioSource: "system" },
  { sourceText: "Hold on let me check something real quick... yeah okay so if we book ANA through their website directly instead of Google Flights it's actually $870. They have a sale right now that ends next Tuesday.", audioSource: "mic" },
  { sourceText: "Oh wait seriously? $870 direct on ANA? That's actually really good. Last year those flights were like $1100.", audioSource: "system" },
  { sourceText: "Should we just all book it now? Like right now on this call? Before the sale ends?", audioSource: "system" },
  { sourceText: "I'm down. Danny, Priya, you good with ANA at $870?", audioSource: "mic" },
  { sourceText: "Yeah let's do it. Oh wait — does everyone have their passport updated? Mine doesn't expire until 2028 so I'm good.", audioSource: "system" },
  { sourceText: "Mine's good too. Priya just make sure yours has at least six months validity from the travel date, Japan requires that.", audioSource: "mic" },
  { sourceText: "Yep it's valid through 2027, we're fine. Booking now. Do we want Haneda or Narita? Haneda is way closer to the city center.", audioSource: "system", translation: "2027年まで有効だから大丈夫。今予約するね。羽田と成田どっちがいい？羽田の方が都心にずっと近いよ。" },
  { sourceText: "Haneda for sure if the price is the same. Narita to Shinjuku is like a 90-minute train ride, Haneda is 30 minutes on the monorail.", audioSource: "mic", translation: "同じ値段なら絶対羽田。成田から新宿は電車で90分くらいかかるけど、羽田ならモノレールで30分だよ。" },
  { sourceText: "Okay accommodation. This is where it gets interesting. I think we should do a mix — like regular hotel in Tokyo, ryokan in Hakone, and maybe a machiya in Kyoto?", audioSource: "system", newTopic: true },
  { sourceText: "Wait what's a machiya?", audioSource: "system" },
  { sourceText: "It's like a traditional Kyoto townhouse. You can rent the whole thing on Airbnb. Wooden interior, tatami rooms, little courtyard garden. Way cooler than a hotel and actually cheaper if you split it four ways.", audioSource: "mic", translation: "京都の伝統的な町家だよ。Airbnbで一棟丸ごと借りられるの。木造の内装、畳の部屋、小さな中庭。ホテルよりずっと雰囲気あるし、4人で割れば実は安い。" },
  { sourceText: "Oh that sounds amazing. Yes. Let's do that for Kyoto.", audioSource: "system" },
  { sourceText: "For Tokyo I was thinking Shinjuku for the hotel. It's the most central, the station connects to literally every train line, and there's a million restaurants around there.", audioSource: "mic", newTopic: true },
  { sourceText: "What about Shibuya though? It's more fun. Like the nightlife is better and it's got that whole Shibuya crossing vibe.", audioSource: "system" },
  { sourceText: "Shibuya is great to visit but Shinjuku is better as a base. Trust me. You can get to Shibuya in like seven minutes anyway, it's one stop on the JR Yamanote line.", audioSource: "mic", translation: "渋谷は遊びに行くにはいいけど、拠点としては新宿の方が便利。渋谷にはJR山手線で一駅、7分で行けるし。" },
  { sourceText: "I actually found a really good hotel in Shinjuku — the HOTEL GRACERY. It's like $120 a night per room and it's right next to Kabukicho and the east exit. Oh and it has a giant Godzilla head on the roof, which is hilarious.", audioSource: "system" },
  { sourceText: "Danny literally choosing hotels based on Godzilla statues.", audioSource: "mic" },
  { sourceText: "Hey the reviews are actually great! 4.3 on Google, super clean, good location. I'm not just picking it for the Godzilla head. ...Okay maybe like 30% for the Godzilla head.", audioSource: "system" },
  { sourceText: "Ha okay fine. That price is actually decent. Two rooms at $120 each, so $60 per person per night. For Shinjuku that's solid.", audioSource: "mic" },
  { sourceText: "OKAY but can we talk about the ryokan situation because this is what I'm most excited about.", audioSource: "system", newTopic: true },
  { sourceText: "Yes! Hakone ryokan. So I've been deep in this rabbit hole. The top tier ones like Gora Kadan are like $800 a night and you need to book months in advance.", audioSource: "mic", translation: "箱根の旅館ね。めちゃくちゃ調べたんだけど、強羅花壇みたいな高級旅館は一泊800ドルくらいで、何ヶ月も前に予約しないといけない。" },
  { sourceText: "EIGHT HUNDRED? Per person?!", audioSource: "system" },
  { sourceText: "Per room. But still, that's insane. There are really nice mid-range ones though. I found this place called Hakone Ginyu — it's $280 a night, private open-air onsen on the balcony of each room, kaiseki dinner included.", audioSource: "mic", translation: "一部屋だけどね。でもやっぱり高い。中価格帯でいい所もあるよ。箱根吟遊っていう旅館が一泊280ドルで、各部屋に露天風呂付き、懐石料理の夕食込み。" },
  { sourceText: "Did you say private onsen? On the BALCONY? Okay I'm sold.", audioSource: "system" },
  { sourceText: "Wait sorry — hold on, my dog is going absolutely insane at the mailman. BUSTER. BUSTER STOP. Sorry one sec.", audioSource: "system" },
  { sourceText: "Lol take your time.", audioSource: "mic" },
  { sourceText: "Okay I'm back. Sorry. So yeah Hakone Ginyu, $280 a night. If we do two rooms for two nights that's $1120 total, so $280 per person for two nights. That includes dinner AND breakfast.", audioSource: "system" },
  { sourceText: "That's actually really reasonable. And you literally cannot do an onsen experience anywhere else in the world so it's worth it.", audioSource: "mic" },
  { sourceText: "Oh my god okay speaking of food. We need to talk about food because I have a LIST.", audioSource: "system", newTopic: true },
  { sourceText: "Of course Danny has a list.", audioSource: "mic" },
  { sourceText: "Shut up, you'll thank me. Okay so — Tsukiji Outer Market for breakfast sushi, that's non-negotiable. Then there's this place Fuunji in Shinjuku that does insane tsukemen, the line is always around the block but it moves fast.", audioSource: "system", translation: "築地場外市場で朝の寿司、これは絶対。あと新宿の風雲児っていうつけ麺屋がヤバいんだけど、いつも行列。でも回転は早い。" },
  { sourceText: "Oh Fuunji! I've heard of that place. The broth is supposed to be this crazy thick fish-based thing right?", audioSource: "mic" },
  { sourceText: "Yes! And you dip the noodles in it. It's thick like gravy almost. Life-changing. Also Marcus told me about this tiny yakitori place under the train tracks in Yurakucho — it's called Yakitori Alley, it's like six seats and an old dude grilling chicken over charcoal.", audioSource: "system", translation: "そう！麺をつけて食べるの。とろみがグレービーみたいに濃いんだよ。人生変わる。あとマーカスが有楽町のガード下にある焼き鳥屋教えてくれた。焼き鳥横丁っていって、席が6つくらいしかなくて、おじいちゃんが炭火で鶏焼いてるの。" },
  { sourceText: "I want to do a conveyor belt sushi place too. Like the ones where the plates come around on a little train.", audioSource: "system" },
  { sourceText: "Those are called kaiten-zushi! Yeah we can do that. There's good ones in Shibuya. But honestly the random hole-in-the-wall sushi counters are even better and not much more expensive.", audioSource: "mic", translation: "回転寿司ね！渋谷にいいのあるよ。でも正直、裏通りのカウンター寿司の方が美味しいし、そんなに高くないよ。" },
  { sourceText: "What about that convenience store thing? Like everyone says 7-Eleven in Japan is actually incredible.", audioSource: "system" },
  { sourceText: "Dude yes. The onigiri, the egg sandwiches, the melon pan. Japanese convenience stores put American ones to shame. You could honestly eat like a king for $10 a day if you just did combini food.", audioSource: "mic" },
  { sourceText: "Alright alright, we'll eat everywhere. Can we circle back to the Kyoto plan though? I want to make sure we actually figure out the logistics.", audioSource: "system", newTopic: true },
  { sourceText: "Right. So Tokyo to Kyoto on the shinkansen — which by the way, the JR Pass. We need to figure that out. Danny you looked into this right?", audioSource: "mic" },
  { sourceText: "Yeah so the JR Pass changed recently. It used to be this amazing deal but they raised the prices in October 2023. A 7-day pass is now around $200 USD. The Tokyo-to-Kyoto shinkansen alone is about $130 one way, so if you're doing that round trip plus local JR lines, the pass still saves you money. But barely.", audioSource: "system" },
  { sourceText: "So we should get it right? Since we're also doing Hakone and the Yamanote line in Tokyo covers a lot.", audioSource: "mic" },
  { sourceText: "Actually hold on, the JR Pass doesn't cover the fastest Nozomi trains on the Tokaido shinkansen. You'd have to take the Hikari which is like 20 minutes slower. Is that a dealbreaker?", audioSource: "system", translation: "あ、ちょっと待って。JRパスは東海道新幹線の最速ののぞみは使えないんだよ。ひかりに乗ることになるけど、20分くらい遅い。それって問題かな？" },
  { sourceText: "Twenty minutes? No, who cares. Get the pass. The convenience of not buying individual tickets every time is worth it alone.", audioSource: "mic" },
  { sourceText: "Okay JR Pass it is. We can order them online before we go and pick them up at the station.", audioSource: "system" },
  { sourceText: "For Kyoto itself — three nights like we said. I really want to do Fushimi Inari early morning before the crowds, like 6 AM. And Arashiyama with the bamboo grove. Oh and Kinkaku-ji, obviously.", audioSource: "mic", translation: "京都は3泊で。伏見稲荷は混む前の早朝、朝6時くらいに行きたい。あと嵐山の竹林と、金閣寺はもちろん。" },
  { sourceText: "Can we do a day trip to Nara from Kyoto? I want to see the deer. I know that's touristy but I don't care, I want a deer to bow to me.", audioSource: "system" },
  { sourceText: "Nara is like 45 minutes from Kyoto by train so yeah, easy day trip. We can do Nara in a half day and then Fushimi Inari in the afternoon since it's on the way back.", audioSource: "mic" },
  { sourceText: "Oh wait actually — Priya, didn't you say you wanted to do a tea ceremony?", audioSource: "system" },
  { sourceText: "YES. That's like the one thing I absolutely must do. There's this place in Gion that does a traditional matcha tea ceremony for like $40 per person. I already bookmarked it.", audioSource: "system", translation: "そう！絶対やりたいの。祇園に伝統的な抹茶の茶道体験ができるところがあって、一人40ドルくらい。もうブックマークしてある。" },
  { sourceText: "Okay so let's talk money real quick because I want to make sure we're all on the same page.", audioSource: "mic", newTopic: true },
  { sourceText: "Yeah good call. So flights are $870 per person, locked in. What's the breakdown for everything else?", audioSource: "system" },
  { sourceText: "Let me rough it out. Hotel in Tokyo, five nights at $60 per person is $300. Machiya in Kyoto, three nights, I found one that's $200 a night for the whole house so that's $50 per person per night, $150 total. Ryokan, $280 per person for two nights.", audioSource: "mic" },
  { sourceText: "So accommodation is roughly $730 per person total?", audioSource: "system" },
  { sourceText: "Yeah. Then JR Pass is $200. Figure $50 a day for food if we mix cheap and nice meals — that's $550 for eleven days. Activities and entrance fees, maybe $150. So all-in excluding flights, we're looking at like $1630 per person.", audioSource: "mic" },
  { sourceText: "Plus the flights that's $2500 per person. That's actually very doable. I was expecting way worse.", audioSource: "system" },
  { sourceText: "We should set up a Splitwise group so we can track shared expenses. Last trip it was a nightmare trying to figure out who owed what.", audioSource: "mic" },
  { sourceText: "Already on it. I just created the group — Japan 2026. I'll add everyone.", audioSource: "system" },
  { sourceText: "Oh one more thing — should we get pocket WiFi or just do eSIM? I've heard the eSIM situation in Japan is way better now.", audioSource: "system", newTopic: true },
  { sourceText: "eSIM for sure. Ubigi or Airalo, like $15 for 10 gigs. Way easier than carrying around a pocket WiFi device.", audioSource: "mic" },
  { sourceText: "Cool. Okay I think we have a solid plan. Can someone make a shared Google Doc with the itinerary? Day by day, with the hotel bookings, train times, restaurant list, all of it.", audioSource: "system" },
  { sourceText: "I'll make the doc tonight. I'll do a rough day-by-day and then everyone can add stuff. I'll share it in the group chat.", audioSource: "mic" },
  { sourceText: "Amazing. Oh wait — Danny, what was that izakaya you kept talking about? The one in Golden Gai?", audioSource: "system" },
  { sourceText: "Oh my god yes. It's called Albatross. It's this tiny bar in Golden Gai, like literally fits maybe ten people, three floors, and the whole ceiling is covered in chandeliers. It's completely unhinged. We HAVE to go.", audioSource: "system", translation: "アルバトロスっていうの。ゴールデン街の小さなバーで、10人くらいしか入れないんだけど3階建てで、天井全部シャンデリアで覆われてる。ぶっ飛んでるよ。絶対行こう。" },
  { sourceText: "Golden Gai is that area in Shinjuku with like 200 tiny bars crammed into six alleys right? I've seen photos, it looks insane.", audioSource: "mic", translation: "ゴールデン街って新宿の6本の路地に200軒くらいの小さなバーがひしめき合ってるところだよね？写真見たことあるけど、すごそう。" },
  { sourceText: "Yep. Some of them only fit four people. It's the most Tokyo thing ever. Okay I think we're good. Let's all book the ANA flights before Tuesday, I'll send the ryokan link in the chat, and someone handle the machiya.", audioSource: "system" },
  { sourceText: "I'll book the machiya tonight. Priya, keep us posted on the visa situation. And everyone download the Navitime app for train navigation in Japan — it's way better than Google Maps for transit there.", audioSource: "mic", translation: "町家は今夜予約するね。プリヤ、ビザの件は進捗教えて。あとみんな日本の電車乗り換えにNavitimeアプリ入れといて。Google Mapsよりずっと使いやすいから。" },
  { sourceText: "This is gonna be so good. Okay I gotta go, Buster needs his walk and he's giving me the look. Talk later!", audioSource: "system" },
  { sourceText: "Bye Danny. Bye Priya. I'll have the doc ready by tonight, check the group chat.", audioSource: "mic" },
];

const BRAIN_BLOCKS: BlockSeed[] = [
  { sourceText: "Okay okay okay. So I've been noodling on this for like two weeks now and I think it's time to actually talk it out. The idea is... an AI-powered recipe and meal planning app.", audioSource: "mic", newTopic: true },
  { sourceText: "The core loop is dead simple. You open your fridge, you snap a photo, and the app figures out what you've got in there and suggests recipes you can actually make right now. No grocery run required.", audioSource: "mic" },
  { sourceText: "Like I'm staring at my fridge right now and there's... half a block of cheddar, some eggs, leftover rice from Tuesday, a sad looking bell pepper, and sriracha. What do I make? I genuinely don't know. That's the problem.", audioSource: "mic" },
  { sourceText: "But wait, hold on. Before I get excited. There are already apps doing this. Let me think through the competitive landscape because if I can't differentiate I'm dead on arrival.", audioSource: "mic", newTopic: true },
  { sourceText: "SuperCook is the obvious one. You check off ingredients you have and it matches recipes. It works but it's so... manual. You're literally scrolling through a checklist of 500 ingredients. Nobody wants to do that every time they cook.", audioSource: "mic" },
  { sourceText: "Then there's Whisk. Samsung bought them. They're more about recipe saving and meal planning but the actual intelligence layer is thin. It's basically a glorified bookmarking app with a grocery list bolted on.", audioSource: "mic" },
  { sourceText: "Mealime is interesting — they do the meal planning and dietary restriction thing pretty well actually. Clean UI, good onboarding. But they don't do the fridge scanning thing at all. It's all pre-planned meals, very structured.", audioSource: "mic" },
  { sourceText: "And Yummly, which is the big one. Tons of recipes, decent personalization, but it feels bloated. Like they're trying to be everything — social network, cooking videos, smart thermometer integration. They lost the plot a bit.", audioSource: "mic" },
  { sourceText: "So none of them are really nailing the thing I care about which is... hmm, what IS the thing I care about exactly.", audioSource: "mic" },
  { sourceText: "Okay I think it's this. The multi-household dietary restriction angle. Like in my apartment right now — I'm lactose intolerant, my girlfriend is pescatarian, and when my sister visits she's doing keto. Finding ONE meal that works for all three of us is genuinely hard.", audioSource: "mic", newTopic: true },
  { sourceText: "And that's not even a complicated household! Think about families with a kid who has a nut allergy, a parent doing Whole30, and a teenager who's just gone vegetarian. That's a real family. That's millions of families.", audioSource: "mic" },
  { sourceText: "None of the competitors handle this well. Mealime lets you set ONE dietary profile. SuperCook doesn't even think about it. The multi-profile household thing — that's the wedge. That's what makes this different.", audioSource: "mic" },
  { sourceText: "Wait no, it's even bigger than that. It's not just restrictions, it's preferences over time. Like I had Thai food three times this week, maybe don't suggest pad thai again. Or I told you last month I'm trying to eat more iron-rich foods. Remember that.", audioSource: "mic" },
  { sourceText: "It's like having a personal chef who actually knows your whole household. Okay I'm getting excited. Let me poke holes in this before I get carried away.", audioSource: "mic" },
  { sourceText: "Business model. Let me think about this seriously because 'freemium recipe app' is not exactly a sentence that makes VCs salivate.", audioSource: "mic", newTopic: true },
  { sourceText: "Option one is the obvious freemium play. Free tier gets basic recipe suggestions, maybe 10 a week. Premium at like $7.99 a month unlocks unlimited suggestions, multi-profile households, smart substitutions, full nutritional breakdown.", audioSource: "mic" },
  { sourceText: "But honestly the real money... hmm actually, the real money might be in grocery partnerships. If I know what's in your fridge and what recipe you picked, I know exactly what you need to buy. One-tap order through Instacart, Walmart, whatever. That's affiliate revenue on every single cooking session.", audioSource: "mic" },
  { sourceText: "Oh and there's a B2B angle too. Meal kit companies like HelloFresh, Blue Apron — they're spending a fortune on menu development and personalization. What if we license the dietary matching engine to them? They plug in their ingredient inventory and our algorithm optimizes their weekly menus for subscriber households.", audioSource: "mic" },
  { sourceText: "Wait, that's actually... that might be the bigger business. The consumer app is the trojan horse, the B2B licensing is where the margins are. Hmm. But that's a different company. Don't get distracted. Consumer first, prove the tech, then B2B.", audioSource: "mic" },
  { sourceText: "Okay target market. Who's the person who downloads this app day one.", audioSource: "mic", newTopic: true },
  { sourceText: "It's... honestly it's me and everyone I know. Late twenties to late thirties, dual income household or busy single professional. You care about eating well but you don't have time to meal plan. You end up ordering DoorDash three times a week and feeling guilty about it.", audioSource: "mic" },
  { sourceText: "Parents especially. Oh my god, parents. The mental load of figuring out what to feed a family every single day. I've heard so many friends complain about this. It's not the cooking that's hard, it's the deciding.", audioSource: "mic" },
  { sourceText: "Ugh, speaking of food — I haven't eaten lunch and it's 1:30. The irony of brainstorming a recipe app while I have no idea what to eat is... not lost on me. Okay focus, I'll grab something after this.", audioSource: "mic" },
  { sourceText: "Tech stack. This is the part I actually know how to think about.", audioSource: "mic", newTopic: true },
  { sourceText: "For the fridge photo recognition — I don't want to train my own model, at least not yet. There's Google Cloud Vision which is solid for general object detection. Clarifai has a specific food recognition model. And honestly GPT-4o and Claude can identify food items from photos pretty accurately now.", audioSource: "mic" },
  { sourceText: "I think for MVP I just use a multimodal LLM. Send the fridge photo, get back a structured list of identified ingredients with confidence scores. It won't be perfect but it'll be good enough to validate the concept.", audioSource: "mic" },
  { sourceText: "Recipe database is the other big piece. Spoonacular API has like 500,000 recipes with full nutritional data, dietary tags, ingredient lists. $30 a month for their starter plan. That's a no-brainer for MVP versus trying to build my own database.", audioSource: "mic" },
  { sourceText: "Hmm actually, I wonder about Spoonacular's dietary filtering though. Like can it handle 'find me a recipe that's simultaneously dairy-free AND pescatarian AND low-carb using these 8 ingredients'? I need to test that. If their API can't do compound filters I might need to build a matching layer on top.", audioSource: "mic" },
  { sourceText: "And for nutritional data beyond what Spoonacular gives me, USDA FoodData Central is free and insanely comprehensive. Like down to micronutrient levels. That's what powers the 'you should eat more iron' personalization.", audioSource: "mic" },
  { sourceText: "Oh wait, I should think about the app itself. React Native probably? Cross platform, I can ship iOS and Android from one codebase. Or... do I even need Android for launch? Maybe iOS only to start. The target demo skews iPhone.", audioSource: "mic" },
  { sourceText: "Okay MVP scope. I need to be ruthless about this because I will absolutely over-engineer it if I'm not careful.", audioSource: "mic", newTopic: true },
  { sourceText: "Core MVP features. One: photo-based ingredient detection. Two: multi-profile dietary restrictions, support at least two profiles per household. Three: recipe suggestions filtered by what you have and what everyone can eat. That's it. That's the MVP.", audioSource: "mic" },
  { sourceText: "No grocery integration. No meal planning calendar. No social features. No cooking videos. No smart kitchen device integrations. None of that. Just the core loop — photo, profiles, recipes. Ship it in six weeks.", audioSource: "mic" },
  { sourceText: "Hmm actually... is six weeks realistic? Photo recognition integration, dietary profile system, recipe matching engine, basic UI. For a solo dev working full time on it... yeah, six weeks is tight but doable if I don't get precious about the UI.", audioSource: "mic" },
  { sourceText: "Wait, is anyone actually going to want this? Like I keep saying 'this is a problem' but is it MY problem or is it A problem? Maybe I'm just bad at cooking and everyone else is fine.", audioSource: "mic" },
  { sourceText: "No. No, I've literally heard this complaint from like fifteen different people in the last month. And the 'what's for dinner' search term gets insane Google volume. This is real. Don't talk yourself out of it. Keep going.", audioSource: "mic" },
  { sourceText: "Names. I hate naming things but let me just brainstorm for a second. FridgeAI — no, that's terrible and too literal. PantryPal — too cutesy. CookSmart — probably taken. Mise, like mise en place? That's actually not bad. Short, food-related, implies preparation.", audioSource: "mic", newTopic: true },
  { sourceText: "Or Supper. Simple, warm, approachable. 'What should we have for Supper?' That works as a sentence. Okay I like Supper and Mise. I'll check the domains later.", audioSource: "mic" },
  { sourceText: "Go-to-market. I'm not going to do paid ads at launch, that's burning money. The play is food TikTok and Instagram Reels. Record myself opening my fridge, using the app, cooking what it suggests. The before and after is inherently visual and shareable.", audioSource: "mic", newTopic: true },
  { sourceText: "Also Product Hunt launch, obviously. And I should find like 50 food bloggers and mommy bloggers and offer them free premium for a year in exchange for an honest review. User-generated content is the engine here.", audioSource: "mic" },
  { sourceText: "Pricing at launch. Free tier with 5 recipe lookups per week, enough to get hooked. Premium at $5.99 a month or $49.99 a year. The annual plan is the real target — that's where retention lives.", audioSource: "mic" },
  { sourceText: "Oh and a family plan. $8.99 a month for up to 6 profiles. That's the multi-household angle monetized directly. Actually wait, should the multi-profile thing be premium only? That's literally the differentiator... but if it's locked behind a paywall people won't experience what makes us different.", audioSource: "mic" },
  { sourceText: "Okay compromise. Free gets two profiles. Premium gets six. That way a couple can try the multi-profile thing for free but a full family needs to upgrade. Yeah, that feels right.", audioSource: "mic" },
  { sourceText: "Alright. Next steps. This week I need to do three things. One, build a quick prototype of the photo recognition with Claude's API, just to see how good the ingredient detection actually is. Two, interview ten people — five parents, five young professionals — about how they decide what to cook. And three, check if supper.app or mise.app domains are available.", audioSource: "mic" },
  { sourceText: "Going back to the B2B thing for a second — I keep thinking about it. If I build this dietary matching engine right, with the multi-profile constraint satisfaction... that's genuinely hard technology. That's defensible IP. The consumer app might be the easy part and the engine underneath might be the actual company. Just... filing that thought away for now.", audioSource: "mic" },
  { sourceText: "Okay I think that's enough for today. I'm going to go make lunch. Probably just eggs and rice since that's what's in the fridge. God I really do need this app.", audioSource: "mic" },
];

const STUDY_BLOCKS: BlockSeed[] = [
  { sourceText: "Alright, exam is Thursday. I'm honestly kind of freaking out. Where do you wanna start?", audioSource: "system", newTopic: true },
  { sourceText: "Let's start with Raft since that's probably the biggest chunk of the exam. You good on leader election?", audioSource: "mic" },
  { sourceText: "Uh, kind of? I know there's like terms and heartbeats and stuff. Walk me through it?", audioSource: "system" },
  { sourceText: "Okay so in Raft, every node is in one of three states: follower, candidate, or leader. They all start as followers. The leader sends periodic heartbeats to maintain authority. If a follower doesn't hear from the leader before its election timeout, it promotes itself to candidate, increments its term, votes for itself, and sends RequestVote RPCs to everyone else. You need a strict majority to win.", audioSource: "mic" },
  { sourceText: "Wait, what happens if two nodes both become candidates at the same time? Like a split vote?", audioSource: "system" },
  { sourceText: "That's why Raft uses randomized election timeouts — each node picks a random timeout between like 150 and 300 milliseconds, so it's unlikely two nodes time out simultaneously. But if they do split the vote, the term ends with no winner and they retry with new random timeouts. The key safety property is at most one leader per term.", audioSource: "mic" },
  { sourceText: "Oh that's actually clever. It's like... a voting system but for computers. And the randomization breaks ties.", audioSource: "system" },
  { sourceText: "Okay what about log replication though? That's the part I always mix up.", audioSource: "system", newTopic: true },
  { sourceText: "So once you have a leader, all client writes go through it. The leader appends the entry to its log, sends AppendEntries RPCs to all followers, and once a majority acknowledges, the entry is committed. Committed means safe — even if the leader crashes, the new leader is guaranteed to have it.", audioSource: "mic" },
  { sourceText: "Wait, why is that guaranteed? What if a node that DOESN'T have the entry wins the election?", audioSource: "system" },
  { sourceText: "It can't! That's the beautiful part. The RequestVote RPC includes the candidate's log info, and followers reject votes from candidates whose logs are less up-to-date. So the winner always has the most complete committed log.", audioSource: "mic" },
  { sourceText: "Ohhhh THAT'S what the election restriction is for. Okay that just clicked for me. The professor's slides made it seem way more complicated than it is.", audioSource: "system" },
  { sourceText: "Dude the professor's slides are so bad. Half of them are just screenshots of the paper with no explanation.", audioSource: "mic" },
  { sourceText: "Speaking of bad explanations, can we talk about Paxos? Because I've read the paper twice and I still feel like I'm missing something.", audioSource: "system", newTopic: true },
  { sourceText: "Okay so Paxos has three roles: proposers, acceptors, and learners. A proposer picks a proposal number, does a prepare phase to check if any value has already been accepted, then does an accept phase to commit. Unlike Raft's strong leader, any node can propose.", audioSource: "mic" },
  { sourceText: "So it's two phases? Like two-phase commit?", audioSource: "system" },
  { sourceText: "No no, don't confuse those! Two-phase commit is for distributed transactions, totally different — we'll get to it. Paxos's prepare phase discovers what's already been decided, the accept phase proposes a value. The proposal numbers create a total ordering — if a proposer finds a value was already accepted, it MUST propose that value, not its own. That's what preserves consistency.", audioSource: "mic" },
  { sourceText: "I think the reason everyone says Paxos is confusing is that Lamport wrote the paper as this weird parable about a Greek parliament. And then 'Paxos Made Simple' starts with 'The Paxos algorithm is simple' and proceeds to not be simple at all. Like why.", audioSource: "system" },
  { sourceText: "Yeah the whole reason Raft exists is because grad students couldn't implement Paxos correctly. Ongaro and Ousterhout literally did a study showing students learned Raft faster and implemented it with fewer bugs.", audioSource: "mic" },
  { sourceText: "Alright let's move to CAP. I think I get the basics but I always mess up the real-world examples.", audioSource: "system", newTopic: true },
  { sourceText: "So the theorem says in the presence of a network partition, you have to choose between consistency and availability. What trips people up is it's not about choosing two out of three in normal operation — it's specifically about what happens during a partition. Since partitions always happen in distributed systems, you're really choosing between C and A.", audioSource: "mic" },
  { sourceText: "Right. So DynamoDB is AP — stays available during partitions but might serve stale reads. And Google Spanner is CP because of TrueTime with the atomic clocks, and it'll refuse requests rather than serve inconsistent data?", audioSource: "system" },
  { sourceText: "Exactly. And here's where you messed up on the homework — you wrote that Cassandra was CP, but it's AP by default with tunable consistency. You can configure quorum reads and writes to make it more CP-like, but out of the box it prioritizes availability. That's probably why you lost points.", audioSource: "mic" },
  { sourceText: "Okay let's do vector clocks. Can we work through an actual example? I need to see concrete numbers or I won't remember it.", audioSource: "system", newTopic: true },
  { sourceText: "Sure. Three nodes: A, B, C, everyone starts at [0, 0, 0]. Node A does a local event, clock becomes [1, 0, 0]. A sends a message to B. When B receives it, B takes the element-wise max of its own clock and the incoming one, then increments its own position. So B goes [0, 0, 0] max with [1, 0, 0] gives [1, 0, 0], then increments to [1, 1, 0].", audioSource: "mic" },
  { sourceText: "Okay now what if C does a local event independently? Its clock goes to [0, 0, 1]. And then comparing B's [1, 1, 0] with C's [0, 0, 1]... B is higher in positions 0 and 1, C is higher in position 2. So they're concurrent?", audioSource: "system" },
  { sourceText: "Yes! Neither vector dominates the other, so they're concurrent events. If one is greater-than-or-equal in ALL positions, it happened after. Otherwise concurrent. That's the whole insight — Lamport clocks give a partial order but can't detect concurrency. Vector clocks can, which is why Dynamo used them.", audioSource: "mic" },
  { sourceText: "OH. Okay I was overcomplicating this. It's literally just element-wise comparison.", audioSource: "system" },
  { sourceText: "Okay, BFT time. This is the one that scares me. Nodes can actively lie right? How many faulty nodes can you even tolerate?", audioSource: "system", newTopic: true },
  { sourceText: "So Byzantine faults are the worst case — nodes can crash, lie, send contradictory messages to different peers, even collude. You need 3f plus 1 total nodes to tolerate f Byzantine faults. The faulty node can say one thing to one group and something different to another, so you need enough honest nodes to outvote the liars even in the worst case.", audioSource: "mic" },
  { sourceText: "That's so expensive compared to crash fault tolerance where you only need 2f plus 1. Like you're adding a whole extra f nodes just to handle lying.", audioSource: "system" },
  { sourceText: "Yeah and that's why most practical systems like etcd and ZooKeeper just use Raft for crash faults. You trust the nodes in your own data center. BFT is more relevant for blockchain and adversarial environments where you can't trust participants.", audioSource: "mic" },
  { sourceText: "Makes sense. Oh by the way, did you finish the OS homework? The one on page tables? I haven't even started and it's due Friday.", audioSource: "system" },
  { sourceText: "Ugh don't remind me. Also the TA's grading on the last assignment was insane — I lost 5 points because I didn't 'show enough intermediate steps' on the TLB question. I literally showed the correct answer! What more do you want from me.", audioSource: "mic" },
  { sourceText: "Ha yeah that TA is brutal. Okay wait, what time is it... dude it's been two hours already. We should speed through the last few topics though.", audioSource: "system" },
  { sourceText: "Alright, consistent hashing. You hash keys and servers onto a ring, each key goes to the next server clockwise. When you add or remove a node, only keys between it and its predecessor move — unlike naive hashing where you'd rehash everything. Virtual nodes fix uneven distribution by giving each server like 200 points on the ring.", audioSource: "mic", newTopic: true },
  { sourceText: "Got it. What about gossip protocols, that's how nodes share state without a coordinator right? Each node picks a random peer and exchanges info, spreads exponentially?", audioSource: "system" },
  { sourceText: "Yep, O of log n rounds to reach all nodes. Cassandra uses it for failure detection — each node gossips its heartbeat and if it stops updating, others mark it down. No single point of failure.", audioSource: "mic" },
  { sourceText: "Okay last thing — two-phase commit. You said earlier not to confuse it with Paxos. What's the actual problem with 2PC?", audioSource: "system", newTopic: true },
  { sourceText: "2PC is for distributed transactions. Phase one the coordinator asks 'can you commit', phase two it sends the decision. The fatal flaw is it's blocking — if the coordinator crashes between phases, all participants are stuck holding locks, waiting for a decision that may never come. Three-phase commit adds a pre-commit phase to fix that, but it breaks under network partitions, so in practice people just use 2PC with a persistent transaction log.", audioSource: "mic" },
  { sourceText: "One more thing — remember the professor said 'pay attention to the assumptions each algorithm makes about the failure model'? That's gotta be a huge exam hint. Raft assumes crash-stop, BFT assumes arbitrary faults, 2PC assumes a reliable coordinator. She also said 'know the tradeoffs, not just the mechanisms.'", audioSource: "system" },
  { sourceText: "Yeah I bet there'll be a compare-and-contrast question. Like 'when would you choose Raft over Paxos' or 'why is 2PC unsuitable for wide-area networks.' Okay I feel maybe 60% ready. Let's do another session tomorrow? I still can't get step 3 on that homework problem about the replicated state machine losing quorum during a partition.", audioSource: "mic" },
  { sourceText: "Oh that one took me forever. The trick is that uncommitted entries CAN be overwritten by a new leader — people assume everything in the log is safe, but only committed entries are guaranteed. I'll send you my solution tonight so you can compare. We got this.", audioSource: "system" },
];

const MEETING_BLOCKS: BlockSeed[] = [
  { sourceText: "Alright let's get started. I think we're still waiting on Marcus but let's not hold up. Sprint review first, then planning. Sarah, you wanna kick us off?", audioSource: "mic", newTopic: true },
  { sourceText: "Sure thing. So the big one this sprint was the OAuth2 flow. It's fully implemented — Google, GitHub, and email magic links all working. It's behind a feature flag right now. I also fixed that race condition in the session middleware that was causing the intermittent 401s.", audioSource: "system" },
  { sourceText: "Nice. How confident are we on the token refresh logic? That was the piece I was worried about.", audioSource: "mic" },
  { sourceText: "Honestly, the happy path is solid. The thing I'm less sure about is when users have like four tabs open and the refresh token rotates. I wrote tests for it but I want to do some manual testing with the devtools throttling.", audioSource: "system" },
  { sourceText: "Can you hear me? Sorry, my mic was being weird. Did I miss anything?", audioSource: "system" },
  { sourceText: "Hey Priya. No we just started, Sarah was going through her sprint items. Go ahead Sarah.", audioSource: "mic" },
  { sourceText: "Yeah that was basically it. OAuth2 plus the session fix. Oh and I reviewed Jake's Stripe PR but I have some comments on it still.", audioSource: "system" },
  { sourceText: "Cool, we'll come back to that PR. Jake, what about you?", audioSource: "mic", newTopic: true },
  { sourceText: "So Stripe integration is mostly done. Subscriptions, checkout flow, webhook handling — all working. The invoicing piece is where I'm stuck though. Legal still hasn't signed off on our tax calculation approach and I literally cannot ship without that.", audioSource: "system" },
  { sourceText: "That's been sitting for over a week now. I'll escalate it today. When they unblock you, how long to finish?", audioSource: "mic" },
  { sourceText: "Two days max. The code is written, I just need to plug in their approved tax rates and run the integration tests against the staging Stripe account.", audioSource: "system" },
  { sourceText: "Got it. Priya, how's the dashboard redesign?", audioSource: "mic" },
  { sourceText: "So the new dashboard UI is done, the component library migration went pretty smoothly. But I need to flag something — the analytics page is really slow. Like 8 seconds to load on staging. I profiled it and it's mostly the API response time, not the frontend.", audioSource: "system" },
  { sourceText: "Yeah that query is a disaster. It's doing 6 joins across three tables with no caching. I've been saying we need to fix that for two sprints now.", audioSource: "mic" },
  { sourceText: "Hey sorry I'm late, I was on a call with the investor update people. What did I miss?", audioSource: "system" },
  { sourceText: "Hey Marcus. Sprint review — Sarah shipped OAuth2, Jake's blocked on Stripe invoicing waiting for legal, Priya finished the dashboard redesign but we have a perf issue on analytics. We were just about to dig into that.", audioSource: "mic" },
  { sourceText: "Got it. Quick question — when we say the dashboard is slow, is that something customers have noticed or is it just internal?", audioSource: "system" },
  { sourceText: "Customers are complaining. We got three support tickets last week about it. One of them was from that enterprise prospect, the fintech company.", audioSource: "mic" },
  { sourceText: "Oh yikes. Okay yeah that needs to be top priority then.", audioSource: "system" },
  { sourceText: "Agreed. So that actually transitions us into planning. Let me lay out what I'm thinking for next sprint priorities.", audioSource: "mic", newTopic: true },
  { sourceText: "Number one, OAuth2 rollout — remove the feature flag, roll out to 100% of users. Sarah, that's yours. Number two, dashboard performance fix. Number three, Stripe invoicing once legal unblocks Jake. And four, we need an API migration guide for the auth changes since it's a breaking change for integrators.", audioSource: "mic" },
  { sourceText: "For the dashboard perf, I think we have two options. We either add Redis caching in front of the analytics queries, or we set up materialized views in Postgres and refresh them on a schedule.", audioSource: "system" },
  { sourceText: "I'd lean toward materialized views honestly. Redis adds operational complexity — another service to monitor, cache invalidation headaches, one more thing to break at 2 AM.", audioSource: "mic" },
  { sourceText: "But materialized views have staleness issues. If someone creates a new record and checks analytics immediately, they won't see it. At least with Redis we control the TTL precisely.", audioSource: "system" },
  { sourceText: "How often do people actually check analytics right after creating records though? I feel like that's an edge case we're over-indexing on.", audioSource: "mic" },
  { sourceText: "Marcus is that something you have data on? Like how frequently users are hitting the analytics page?", audioSource: "system" },
  { sourceText: "Uh, I can pull that from Mixpanel. Give me a sec... actually let's take that offline, I don't wanna derail the whole meeting. I'll send the data to Slack after.", audioSource: "system" },
  { sourceText: "Fair enough. Let's go with materialized views as the default plan, and if the staleness is a real problem we can layer Redis on top later. Sarah, you wanna own this since you're lighter after OAuth ships?", audioSource: "mic" },
  { sourceText: "Yeah I can take it. I've been wanting to clean up those queries anyway. Some of them are... I mean, we wrote them during the hackathon and they show it.", audioSource: "system" },
  { sourceText: "That actually brings up something I keep wanting to raise. We have a LOT of tech debt from that hackathon era. The analytics queries are just one example. The notification system is held together with duct tape, the job queue has no retry logic, and half our error handling is just console.log and pray.", audioSource: "system", newTopic: true },
  { sourceText: "You're right and we keep punting it. This is the third sprint in a row someone's brought up the job queue.", audioSource: "mic" },
  { sourceText: "Can we at least allocate like 20% of the sprint to tech debt? Just carve it out so it doesn't keep getting deprioritized every time a customer issue comes up.", audioSource: "system" },
  { sourceText: "I'm fine with that. Marcus, does that work from a product perspective?", audioSource: "mic" },
  { sourceText: "I mean, as long as the OAuth rollout and the dashboard fix ship on time, I don't care how you allocate the rest. Just keep me in the loop if timelines slip.", audioSource: "system" },
  { sourceText: "Oh speaking of things slipping — we need to do a postmortem on last Wednesday's incident. The one where the webhook processor went down for 45 minutes and we lost a batch of Stripe events.", audioSource: "mic", newTopic: true },
  { sourceText: "Yeah that was my fault. I deployed a migration that locked the webhooks table and the queue backed up. I already wrote up a draft postmortem, I'll share it today.", audioSource: "system" },
  { sourceText: "No blame, we just need to make sure it doesn't happen again. Did we recover all the events?", audioSource: "mic" },
  { sourceText: "We did. Stripe has that event replay feature so we re-fetched everything. But it exposed that we don't have any alerting on queue depth. I literally didn't know it was down until a customer emailed.", audioSource: "system" },
  { sourceText: "Which brings us back to the monitoring conversation. Are we finally going to decide on Datadog versus Grafana? This has been punted three sprints running.", audioSource: "mic", newTopic: true },
  { sourceText: "I've been running both in staging for the last two weeks. Datadog's APM tracing is significantly better. The auto-instrumentation just works. With Grafana we're spending like half a day a week maintaining dashboards.", audioSource: "system" },
  { sourceText: "What's the cost difference?", audioSource: "system" },
  { sourceText: "Datadog is about $23 per host per month for APM. We have 6 hosts so that's like $140 a month. Grafana Cloud is cheaper on paper but when you factor in the engineering time we spend on it, Datadog wins.", audioSource: "mic" },
  { sourceText: "I vote Datadog. Let's just commit and stop having this conversation every two weeks.", audioSource: "system" },
  { sourceText: "Agreed. Jake, can you set up the initial Datadog integration as a stretch goal this sprint? If Stripe wraps up early.", audioSource: "mic" },
  { sourceText: "Sure. I'll timebox it to a day. Oh also — has anyone looked at my PR for the rate limiter? It's been open for three days and I haven't gotten a single review.", audioSource: "system", newTopic: true },
  { sourceText: "That's on me, sorry. I started reviewing it Monday but then got pulled into the incident. I'll finish the review today, I promise.", audioSource: "system" },
  { sourceText: "I also left a few comments on it yesterday Jake, did you see those?", audioSource: "mic" },
  { sourceText: "Oh I didn't, let me check... yeah I see them now. The one about using a sliding window instead of fixed window — that's a good call, I'll update it.", audioSource: "system" },
  { sourceText: "One more thing before we wrap. We really need another backend engineer. Sarah's been carrying the entire backend alone and it's not sustainable, especially with the API migration coming up.", audioSource: "mic", newTopic: true },
  { sourceText: "Completely agree. I love my job but I'm basically a single point of failure right now. If I go on vacation the backend just... doesn't move.", audioSource: "system" },
  { sourceText: "I can open the req today. Do we want senior or mid-level? Senior is going to take longer to fill.", audioSource: "system" },
  { sourceText: "Mid-level is fine if they're strong on Node and Postgres. We can mentor them up. A senior would be nice but we've been trying to hire a senior for four months with no luck.", audioSource: "mic" },
  { sourceText: "I can help with the take-home project review if we get candidates. I actually kind of enjoy those... wait no, I take that back, last time I reviewed twelve of them in a weekend. Never again.", audioSource: "system" },
  { sourceText: "Ha. Okay, I'll put the req up and we'll split the review load evenly this time. Any other business before we wrap?", audioSource: "mic" },
  { sourceText: "Oh wait — completely unrelated but did anyone see the email about the office snack order? They're replacing all the good stuff with those organic rice cakes again. Someone needs to push back on that.", audioSource: "system" },
  { sourceText: "I will literally fight for the Goldfish crackers. But yeah, not a meeting topic. I'll reply to the email.", audioSource: "mic" },
  { sourceText: "Alright, to summarize. Sarah: OAuth rollout plus dashboard perf with materialized views. Jake: finish Stripe invoicing, review cycle on the rate limiter PR, stretch goal on Datadog. Priya: frontend polish on dashboard, help with tech debt backlog. I'll handle the migration guide, escalate legal, and open the backend eng req. Everyone good?", audioSource: "mic" },
  { sourceText: "Sounds good to me.", audioSource: "system" },
  { sourceText: "Yep. Oh and don't forget to share that postmortem Jake.", audioSource: "system" },
  { sourceText: "Will do. Sending it right after this call.", audioSource: "system" },
  { sourceText: "Great. Good sprint everyone. Let's crush it this week.", audioSource: "mic" },
];

// ===========================================================================
// INSIGHTS
// ===========================================================================
const TRIP_INSIGHTS: InsightSeed[] = [
  { text: "Group targeting April 5-15 for a 10-day Japan trip during cherry blossom season" },
  { text: "Flight options from SFO: ANA ~$870 round-trip, JAL ~$890, Zipair budget ~$640, United ~$780" },
  { text: "Budget agreed at $2,500 per person excluding flights, covering hotels, food, trains, activities" },
  { text: "Itinerary plan: 4-5 nights Tokyo (Shinjuku), 3 nights Kyoto, 1-2 nights Hakone ryokan" },
  { text: "7-day JR Pass costs around $200 and covers shinkansen between cities (Hikari, not Nozomi)" },
  { text: "Priya may need advance parole document for H-1B visa re-entry — needs to check with immigration lawyer" },
  { text: "Ryokan in Hakone targeted under $250/night with onsen; booking early is key" },
  { text: "Must-visit food spots: Fuunji tsukemen in Shinjuku, Yakitori Alley in Yurakucho, kaiten-zushi in Shibuya" },
  { text: "Kyoto highlights: Fushimi Inari early morning, Arashiyama bamboo grove, possible Nara day trip" },
  { text: "Danny volunteered to create shared Google Doc for itinerary; Splitwise group for cost splitting" },
];

const BRAIN_INSIGHTS: InsightSeed[] = [
  { text: "Core product: AI recipe app that identifies fridge contents from photos and suggests meals matching household dietary restrictions" },
  { text: "Key differentiator: multi-profile households — one meal that works for lactose intolerant, vegetarian, keto, etc. simultaneously" },
  { text: "Competitive landscape: SuperCook (manual, no AI), Whisk (bookmarking), Mealime (no fridge scan), Yummly (bloated)" },
  { text: "Business model: freemium consumer app ($5.99/mo) + grocery affiliate revenue (Instacart/Walmart) + B2B licensing to meal kit companies" },
  { text: "MVP scope: photo ingredient detection, 2-profile dietary restrictions, recipe matching — ship in 6 weeks" },
  { text: "Tech stack: multimodal LLM for food recognition, Spoonacular API for recipes ($30/mo), USDA FoodData Central for nutrition" },
  { text: "Target market: dual-income households 25-40, parents overwhelmed by daily meal decisions" },
  { text: "Pricing: free tier (5 lookups/week, 2 profiles), premium $5.99/mo (unlimited, 6 profiles), annual $49.99" },
  { text: "Top name candidates: 'Mise' (mise en place) and 'Supper' — need to check domain availability" },
  { text: "Go-to-market: food TikTok/Reels content, Product Hunt launch, 50 food blogger partnerships" },
];

const STUDY_INSIGHTS: InsightSeed[] = [
  { text: "Raft uses strong leader model — all writes go through leader; leader election uses randomized timeouts to avoid split votes" },
  { text: "Raft log replication: leader sends AppendEntries, needs majority acknowledgment before committing; election restriction ensures new leader has all committed entries" },
  { text: "Paxos has three roles (proposer, acceptor, learner) with prepare/accept phases — fundamentally different from 2PC despite sounding similar" },
  { text: "CAP theorem: choose between Consistency and Availability during partitions. DynamoDB/Cassandra = AP, Spanner = CP" },
  { text: "Vector clocks: each node maintains counter vector; compare element-wise — if neither dominates, events are concurrent (unlike Lamport clocks which only give partial ordering)" },
  { text: "Byzantine fault tolerance requires 3f+1 nodes to tolerate f faults — much more expensive than crash fault tolerance (2f+1)" },
  { text: "Consistent hashing: ring structure with virtual nodes for load balancing; gossip protocols converge in O(log n) rounds" },
  { text: "2PC is blocking — if coordinator crashes after prepare, participants are stuck. 3PC adds pre-commit phase but requires no network partitions" },
  { text: "Exam likely to include compare-and-contrast question on failure model assumptions (crash vs Byzantine vs omission)" },
];

const MEETING_INSIGHTS: InsightSeed[] = [
  { text: "Sarah shipped OAuth2 flow with Google, GitHub, and email magic link — currently behind feature flag, ready for 100% rollout" },
  { text: "Token refresh with multiple tabs open is a known edge case in the OAuth2 implementation — filed for next sprint" },
  { text: "Jake's Stripe payment integration is blocked on legal sign-off for tax calculation approach — has been waiting a week" },
  { text: "Dashboard analytics page taking 8 seconds to load — query doing 6 joins with no caching. Sarah will take the perf fix." },
  { text: "Decision made: adopting Datadog over Grafana for monitoring — better APM tracing, acceptable cost at current scale" },
  { text: "Webhook processor outage last Tuesday: failed silently for 90 minutes because no alerting on queue depth" },
  { text: "Background job queue tech debt has been punted for three consecutive sprints — becoming a reliability risk" },
  { text: "Jake's auth middleware PR has been open for 3 days unreviewed — team agreed to 24-hour review SLA going forward" },
  { text: "Sarah identified as single point of failure for backend — team discussed hiring senior backend engineer" },
  { text: "Sprint plan: Sarah -> OAuth rollout + dashboard perf, Jake -> Stripe invoicing + Datadog setup (stretch), migration guide by Wednesday" },
];

// ===========================================================================
// TASKS (with deterministic IDs for MEETING session)
// ===========================================================================
const TRIP_TASKS: TaskSeed[] = [
  { id: TRIP_TASK_IDS.flights, text: "Book round-trip flights SFO -> NRT for April 5-15", details: "Compare ANA ($870), JAL ($890), Zipair ($640), United ($780). Group prefers ANA or JAL for comfort but open to budget if savings are significant. Need to book before prices increase.", size: "large", source: "ai", completed: true },
  { id: TRIP_TASK_IDS.ryokan, text: "Reserve ryokan in Hakone for 2 nights", details: "Budget under $250/night. Must have private onsen. Look at Hakone Ginyu, Yama no Chaya, Senkyoro. Book early for April availability.", size: "large", source: "ai", completed: true },
  { id: TRIP_TASK_IDS.itinerary, text: "Create shared Google Doc for trip itinerary", details: "Danny volunteered. Include: daily schedule, hotel bookings, restaurant reservations, transportation (JR Pass), budget tracker, packing list.", size: "small", source: "ai", completed: true },
  { id: TRIP_TASK_IDS.visa, text: "Check advance parole requirements for H-1B re-entry", details: "Priya needs to verify with immigration lawyer whether she needs advance parole to re-enter US on H-1B after Japan trip. Time-sensitive — may affect whether she can join.", size: "large", source: "ai", completed: true },
];

const BRAIN_TASKS: TaskSeed[] = [
  { id: BRAIN_TASK_IDS.prototype, text: "Build photo recognition prototype with Claude API", details: "Quick prototype to test ingredient detection accuracy from fridge photos. Use Claude's vision capabilities. Measure: how many ingredients correctly identified, false positives, missed items.", size: "large", source: "ai", completed: true },
  { id: BRAIN_TASK_IDS.interviews, text: "Interview 10 target users about meal planning pain points", details: "5 parents, 5 young professionals. Key questions: how they decide what to cook, biggest frustrations, would multi-profile dietary matching change their behavior, willingness to pay.", size: "large", source: "ai" },
  { id: BRAIN_TASK_IDS.domains, text: "Check domain availability for supper.app and mise.app", details: "Also check mise.co, getsupper.com, supperapp.com as fallbacks. Register if available and under $50.", size: "small", source: "ai", completed: true },
  { id: BRAIN_TASK_IDS.spoonacular, text: "Test Spoonacular API compound dietary filtering", details: "Specifically test: can it handle 'dairy-free AND pescatarian AND low-carb' simultaneously? If not, need to build matching layer on top. Document API limitations.", size: "large", source: "ai", completed: true },
];

const STUDY_TASKS: TaskSeed[] = [
  { id: STUDY_TASK_IDS.comparison, text: "Create Raft vs Paxos vs ZAB comparison table", details: "Cover: leader model, fault tolerance, message complexity, liveness guarantees, real-world implementations (etcd, ZooKeeper, Chubby). Focus on what the exam would ask.", size: "large", source: "ai", completed: true },
  { id: STUDY_TASK_IDS.practice, text: "Do practice problems from week 8 problem set", details: "Focus on vector clock exercises and consensus scenarios. Alex will send the problem set. Work through independently then compare answers.", size: "large", source: "manual" },
  { id: STUDY_TASK_IDS.bft, text: "Review Byzantine fault tolerance section", details: "Professor hinted this will be on the exam. Cover: BFT vs CFT, 3f+1 requirement proof intuition, PBFT basics, why most practical systems avoid BFT.", size: "large", source: "ai", completed: true },
  { id: STUDY_TASK_IDS.uncommitted, text: "Solve the uncommitted log entry problem from homework", details: "The scenario where a leader crashes after replicating to minority. Need to trace through what happens during re-election and how the new leader handles the uncommitted entry.", size: "small", source: "manual", completed: true },
];

const MEETING_TASKS: TaskSeed[] = [
  { id: MEETING_TASK_IDS.oauth, text: "Roll out OAuth2 to 100% of users", details: "Remove feature flag, monitor error rates and login success metrics for 48 hours. Have rollback plan ready. Sarah owns this.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.dashboardPerf, text: "Benchmark materialized views for the analytics dashboard", details: "Currently 8 seconds load time. Evaluate materialized views in Postgres with scheduled refresh vs Redis caching. Sarah taking this — target sub-2-second load.", size: "large", source: "ai", completed: true },
  { id: MEETING_TASK_IDS.stripeInvoicing, text: "Complete Stripe invoicing integration", details: "Blocked on legal sign-off for tax calculation. Once unblocked, swap in real tax rates and test with approved config. Jake estimates 2 days of work.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.migrationGuide, text: "Write API migration guide for auth changes", details: "Document breaking changes in auth flow for API consumers. Sarah to draft by Wednesday. Include: new endpoints, token format changes, migration steps.", size: "large", source: "ai", completed: true },
  { id: MEETING_TASK_IDS.datadog, text: "Set up Datadog initial integration", details: "Jake's stretch goal. Install agent, configure APM tracing, set up basic dashboards for API latency and error rates. Timebox to 1 day.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.webhookAlerting, text: "Add alerting on webhook processor queue depth", details: "Post-incident action item from Tuesday's outage. Need alerts when queue depth exceeds threshold. Prevents silent failures.", size: "small", source: "ai" },
  { id: MEETING_TASK_IDS.postmortem, text: "Write postmortem for Friday's webhook processor outage", details: "45 minutes of downtime, lost batch of Stripe events. Root cause: migration locked webhooks table. Include timeline, impact, remediation steps, and prevention measures.", size: "large", source: "ai", completed: true },
  { id: MEETING_TASK_IDS.datadogPricing, text: "Compare Datadog pricing tiers", details: "Team discussed Datadog vs Grafana Cloud. Need detailed pricing comparison for 6 hosts with APM tracing. Factor in engineering time savings.", size: "large", source: "ai", completed: true },
];

// ===========================================================================
// PM SESSION — "Smart Notifications" Feature Spec
// Speakers: Lena (PM, mic), Dev (eng lead, system), Kai (designer, system)
// ===========================================================================
const PM_BLOCKS: BlockSeed[] = [
  // Beat 1: Problem statement — notification fatigue
  { sourceText: "Alright so I wanted to get everyone together because the notification problem is getting serious. We had a 15% drop in engagement last month and I think notifications are a huge part of it.", audioSource: "mic", newTopic: true },
  { sourceText: "Yeah I saw that Mixpanel report. We're sending an average of 47 notifications per user per day. That's insane. No wonder people are turning them off entirely.", audioSource: "system" },
  { sourceText: "It's worse than that actually. I pulled the support ticket data yesterday — notification-related complaints are up 3x since January. People are literally saying 'your app won't stop buzzing me.'", audioSource: "mic" },
  { sourceText: "I had a user interview last week and the woman told me she uninstalled the app specifically because of notification overload. She loved the product otherwise.", audioSource: "system" },
  { sourceText: "That's the scariest part. We're losing users who actually like us because we're annoying them. It's a self-inflicted wound.", audioSource: "mic" },
  { sourceText: "So what's the plan? Are we talking about just letting users adjust their notification settings or is this something bigger?", audioSource: "system" },
  { sourceText: "I think it needs to be bigger. A simple preferences page isn't going to solve the root problem. We need to be smarter about what we send and when.", audioSource: "mic" },

  // Beat 2: Solution — AI-powered batching + priority scoring
  { sourceText: "Okay so I've been thinking about this for a while and I want to pitch an approach. What if we build an intelligent notification system that batches, prioritizes, and learns from user behavior?", audioSource: "mic", newTopic: true },
  { sourceText: "What do you mean by batching exactly?", audioSource: "system" },
  { sourceText: "Instead of sending 47 individual pings throughout the day, we group related notifications and deliver them in 2-3 digests. Like a morning summary, a midday update, and an evening recap. Unless something is truly urgent.", audioSource: "mic" },
  { sourceText: "Slack does something like that with their notification batching. And honestly I think Gmail's priority inbox is the gold standard here — it learns what's important to you over time.", audioSource: "system" },
  { sourceText: "Exactly. So the second piece is priority scoring. Every notification gets a score based on relevance signals — who sent it, what type it is, has the user engaged with similar ones before, time of day sensitivity.", audioSource: "mic" },
  { sourceText: "Are we talking ML here or more like a rules engine?", audioSource: "system" },
  { sourceText: "Phase one would be a weighted scoring model — basically a rules engine with tunable weights. We can ship that in two weeks. Phase two would be a proper ML model trained on user interaction data but that's a Q3 thing.", audioSource: "mic" },
  { sourceText: "I like the phased approach. The rules engine gets us 80% of the value without the ML complexity.", audioSource: "system" },
  { sourceText: "And then the third piece — digest emails. For users who don't want to check the app constantly, we send a daily email digest summarizing everything they missed. This is actually a retention play too because it brings people back.", audioSource: "mic" },
  { sourceText: "Oh that's smart. Notion does daily digests and their re-engagement numbers from email are really strong. I've seen case studies on that.", audioSource: "system" },

  // Beat 3: Technical scoping — preferences API, batching cron, priority model
  { sourceText: "Dev, from a technical standpoint, how are you thinking about this?", audioSource: "mic", newTopic: true },
  { sourceText: "So the preferences API is the foundation. We need endpoints for users to configure: which channels they want notifications on, quiet hours, batching frequency, and per-category toggles. Standard REST, maybe 6-8 endpoints. I'd estimate 3-4 days for that.", audioSource: "system" },
  { sourceText: "What about the data model? Are we bolting this onto the existing user settings or is it its own thing?", audioSource: "mic" },
  { sourceText: "Separate table. NotificationPreferences with a user_id foreign key. Columns for quiet_hours_start, quiet_hours_end, batch_frequency, digest_enabled, digest_time, and then a JSONB column for per-category overrides.", audioSource: "system" },
  { sourceText: "Makes sense. And the batching service?", audioSource: "mic" },
  { sourceText: "That's the meaty part. I'd build it as a cron service that runs every 15 minutes. It pulls pending notifications from a queue, groups them by user and category, scores them, and then either sends immediately if urgent or holds for the next batch window.", audioSource: "system" },
  { sourceText: "What queue are you thinking? We're already on Redis right?", audioSource: "mic" },
  { sourceText: "Yeah Redis sorted sets would work perfectly here. Score is the priority, we just ZRANGEBYSCORE to pull the top items. For the cron itself I'd use BullMQ — we already have it for the email pipeline.", audioSource: "system" },
  { sourceText: "How long for the batching service?", audioSource: "mic" },
  { sourceText: "I'd say a week if I'm being honest. The batching logic itself isn't that bad but the priority scoring rules, the quiet hours handling, timezone stuff — all the edge cases add up.", audioSource: "system" },
  { sourceText: "So preferences API is 3-4 days, batching engine is a week. That's the backend covered. What about the scoring model Dev? How does the priority scoring actually work?", audioSource: "mic" },
  { sourceText: "I'm thinking five signals: sender importance based on the user's interaction history, notification category weight which we can configure per-user, recency decay so older notifications score lower, time-of-day sensitivity, and engagement history — has the user tapped similar notifications before.", audioSource: "system" },
  { sourceText: "That's solid. Should we also factor in the user's current activity? Like if they're actively using the app don't batch, but if they haven't opened it in 6 hours then definitely batch.", audioSource: "system" },
  { sourceText: "Oh that's a good one Kai. Yeah we can use last_active_at from the sessions table. If they're active, immediate delivery. If they're away, batch it. That's actually a really elegant signal.", audioSource: "system" },

  // Beat 4: Design — preferences page, digest template, quiet hours
  { sourceText: "Kai, talk to me about the design side. What does the user-facing part of this look like?", audioSource: "mic", newTopic: true },
  { sourceText: "So I'm envisioning three things. First, a notification preferences page — this is where users configure everything. I want it to feel powerful but not overwhelming. Think iOS notification settings but cleaner.", audioSource: "system" },
  { sourceText: "Can you walk through the layout?", audioSource: "mic" },
  { sourceText: "Yeah. Top section is quiet hours — a simple time range picker. 'Don't disturb me between 10 PM and 8 AM.' Below that, batch frequency — 'Send me updates: Immediately, Every hour, 3 times a day, Once daily.' And then below that, per-category toggles in a clean list. Messages, comments, mentions, task updates, team activity.", audioSource: "system" },
  { sourceText: "I like that it's progressive disclosure. Most users will just set quiet hours and batch frequency and never touch the category toggles.", audioSource: "mic" },
  { sourceText: "Exactly. And we should have sensible defaults so users get value without ever visiting this page.", audioSource: "system" },
  { sourceText: "What about the digest email? That's a design artifact too right?", audioSource: "mic" },
  { sourceText: "Big time. The digest email is basically a mini dashboard. I want it to have: a summary header with key stats, then sections grouped by category — 'You had 12 new comments, 3 mentions, and 2 task completions.' Each section is collapsible with the top 3 most important items shown by default.", audioSource: "system" },
  { sourceText: "Should the email be plain text or HTML?", audioSource: "system" },
  { sourceText: "HTML but minimal. Think Linear's emails — clean typography, good hierarchy, renders great on mobile. Nothing fancy with images or heavy styling. Fast to load, easy to scan.", audioSource: "system" },
  { sourceText: "One thing — the digest should link back to the app. Every item in the digest should be tappable and deep-link to the exact notification in the app. That's the re-engagement mechanism.", audioSource: "mic" },
  { sourceText: "Absolutely. And we should track which items in the digest get tapped. That feeds back into the priority scoring model — if users consistently click on comment notifications but ignore task updates, we learn from that.", audioSource: "system" },

  // Beat 5: Sprint planning — stories, sizing, assignments
  { sourceText: "Okay let's get tactical. Two-week sprint, what are we looking at?", audioSource: "mic", newTopic: true },
  { sourceText: "I see four main stories. Story one: notification preferences API. Story two: notification batching engine. Story three: preferences UI page. Story four: digest email template and sending.", audioSource: "system" },
  { sourceText: "Sizing wise?", audioSource: "mic" },
  { sourceText: "Preferences API is a 5 — it's well-scoped REST endpoints with tests. Batching engine is an 8 — lots of edge cases with quiet hours, timezone handling, priority scoring. Preferences UI is a 5 if Kai has the designs done by Wednesday. Digest email is a 5 — template plus the SendGrid integration.", audioSource: "system" },
  { sourceText: "That's 23 points total. With two engineers that's tight for two weeks but doable if we don't get pulled into other stuff.", audioSource: "mic" },
  { sourceText: "I can have the designs done by Tuesday actually. I already started sketching the preferences page over the weekend.", audioSource: "system" },
  { sourceText: "Nice. Dev, who's taking what?", audioSource: "mic" },
  { sourceText: "I'll take the API and the batching engine since they're tightly coupled. My plan is API first three days, then batching engine for a week. The other engineer — probably Amir — can take the UI and digest email in parallel once Kai's designs land.", audioSource: "system" },
  { sourceText: "We should create the Linear issues for all of this today so everyone can see the sprint board. Can we get those created?", audioSource: "mic" },
  { sourceText: "Yeah I'll create them after this meeting. Or actually, can Ambient create them for us? Save me 20 minutes.", audioSource: "system" },
  { sourceText: "Good call. Let's have Ambient create the four sprint stories in Linear with the sizing and assignments we just discussed.", audioSource: "mic" },
  { sourceText: "Oh and one more thing — we should think about A/B testing this. We can't just flip the switch for everyone. I'd want to see the impact on engagement and retention before rolling out to 100%.", audioSource: "system" },
  { sourceText: "Great point. Let's add that as a follow-up though, not sprint scope. If we try to boil the ocean we won't ship anything.", audioSource: "mic" },
  { sourceText: "Agreed. Ship the feature, test with 10% of users, measure for a week, then decide.", audioSource: "system" },
  { sourceText: "Also wondering about email deliverability. If we're sending digests to everyone we need to make sure our SendGrid sender reputation stays clean. Warm up the IP, authentication records, all that.", audioSource: "system" },
  { sourceText: "Good flag. Dev can you add that to the digest email story as a subtask?", audioSource: "mic" },
  { sourceText: "Will do.", audioSource: "system" },
  { sourceText: "Perfect. I think we're aligned. Let me recap — we're building smart notifications with batching, priority scoring, preferences UI, and digest emails. Four stories, two engineers, two weeks. Dev and Amir splitting the work. Kai designs landing Tuesday. Let's ship this thing.", audioSource: "mic" },
];

const PM_INSIGHTS: InsightSeed[] = [
  { text: "Notification fatigue driving 15% engagement drop and 3x support ticket increase — self-inflicted user attrition" },
  { text: "Intelligent batching strategy: group 47 daily notifications into 2-3 digest windows unless truly urgent" },
  { text: "Priority scoring model uses 5 signals: sender importance, category weight, recency decay, time sensitivity, engagement history" },
  { text: "User activity state (last_active_at) determines delivery mode — immediate when active, batched when away" },
  { text: "Quiet hours with timezone-aware delivery — simple UX with high retention impact" },
  { text: "Digest emails as re-engagement mechanism — Notion case study shows strong re-engagement from daily email summaries" },
  { text: "Phased ML approach: rules engine in sprint 1 (80% value), proper ML model in Q3" },
  { text: "Sprint scoped to 23 story points across 4 stories — tight but doable with 2 engineers in 2 weeks" },
];

const PM_TASKS: TaskSeed[] = [
  { id: PM_TASK_IDS.linearIssues, text: "Create Linear issues for notifications sprint", details: "Create 4 stories in Linear: preferences API (5pt), batching engine (8pt), preferences UI (5pt), digest email (5pt). Assign Dev and Amir respectively.", size: "small", source: "ai", completed: true, completedAt: Date.now() - 20 * 60_000 },
  { id: PM_TASK_IDS.preferencesApi, text: "Implement notification preferences API", details: "REST API with 6-8 endpoints for notification settings. Separate NotificationPreferences table with quiet hours, batch frequency, digest config, and JSONB per-category overrides. Dev owns this, estimated 3-4 days.", size: "large", source: "ai", completed: true, completedAt: Date.now() - 15 * 60_000 },
  { id: PM_TASK_IDS.batchingEngine, text: "Build notification batching service", details: "Cron service on BullMQ that runs every 15 minutes. Pulls from Redis sorted set queue, groups by user/category, applies priority scoring, handles quiet hours with timezone support. Dev owns this, estimated 1 week.", size: "large", source: "ai", completed: true, completedAt: Date.now() - 10 * 60_000 },
  { id: PM_TASK_IDS.preferencesUi, text: "Build notification preferences UI", details: "Preferences page with quiet hours picker, batch frequency selector, and per-category toggles. Kai's designs landing Tuesday. Amir taking this, 5 story points.", size: "large", source: "ai" },
  { id: PM_TASK_IDS.digestDesign, text: "Design digest email template", details: "HTML email template with summary header, category-grouped sections, collapsible items with deep links. Linear-style clean typography. Kai designing, Amir implementing with SendGrid.", size: "large", source: "ai", completed: true, completedAt: Date.now() - 8 * 60_000 },
];

// ===========================================================================
// AGENTS (for MEETING + TRIP sessions)
// ===========================================================================
function buildAgents(baseTs: number): AgentSeed[] {
  const stepTs = (offset: number) => baseTs + offset * 1000;

  return [
    // Agent 1: Research materialized views vs Redis (MEETING)
    {
      id: "demo-agent-matviews",
      kind: "analysis",
      taskId: MEETING_TASK_IDS.dashboardPerf,
      sessionId: MEETING_SESSION_ID,
      task: "Research materialized views vs Redis caching for analytics dashboard",
      taskContext: "Dashboard analytics page loading in 8 seconds. Query does 6 joins across 3 tables. Team discussed materialized views vs Redis — leaning toward mat views but need data.",
      status: "completed",
      result: "## Recommendation: Materialized Views\n\nAfter researching both approaches for your analytics dashboard performance issue, **materialized views are the clear winner** for your use case.\n\n### Key Findings\n\n**Materialized Views (Postgres)**\n- Refresh time for your query volume: ~200ms with `REFRESH MATERIALIZED VIEW CONCURRENTLY`\n- Staleness: configurable refresh interval (recommend 5-minute cron)\n- Complexity: single `CREATE MATERIALIZED VIEW` + cron job\n- No additional infrastructure needed\n- Reduces 8s query to ~50ms read time\n\n**Redis Caching**\n- Adds operational complexity: Redis cluster, monitoring, failover\n- Cache invalidation is genuinely hard for multi-join analytics\n- TTL tuning required per query pattern\n- Additional $50-80/mo for managed Redis (ElastiCache)\n\n### Why Mat Views Win Here\n1. Your analytics data is inherently stale-tolerant — users check trends, not real-time counts\n2. Only 3 enterprise customers check analytics >2x/day (per Mixpanel)\n3. Zero new infrastructure to maintain\n4. Can always layer Redis on top later if needed\n\n### Implementation Plan\n1. Create materialized view for the 6-join analytics query\n2. Add `UNIQUE INDEX` for concurrent refresh support\n3. Set up pg_cron to refresh every 5 minutes\n4. Update API to read from view instead of running live query\n\nExpected result: **8s -> ~50ms** load time.",
      steps: [
        { id: "mv-step-1", kind: "user", content: "Research materialized views vs Redis caching for analytics dashboard", createdAt: stepTs(0) },
        { id: "mv-step-2", kind: "thinking", content: "The team is debating between materialized views and Redis for a slow analytics dashboard. The query does 6 joins and takes 8 seconds. I need to compare both approaches for this specific use case — operational complexity, performance gains, staleness trade-offs, and cost.", createdAt: stepTs(2) },
        { id: "mv-step-3", kind: "plan", content: "Research plan", planTitle: "Research Plan: Materialized Views vs Redis", planContent: "1. Research Postgres materialized views — refresh strategies, concurrent refresh, indexing\n2. Research Redis caching patterns for analytics — cache invalidation strategies, TTL tuning\n3. Compare operational complexity, cost, and performance for a 6-join analytics query\n4. Make a recommendation based on the team's constraints (small team, existing Postgres, no Redis yet)", planApprovalState: "approved", createdAt: stepTs(4) },
        { id: "mv-step-4", kind: "todo", content: "Research checklist", todoItems: [
          { id: "mv-todo-1", content: "Research Postgres materialized view refresh strategies", status: "completed" },
          { id: "mv-todo-2", content: "Research Redis caching patterns for multi-join analytics", status: "completed" },
          { id: "mv-todo-3", content: "Compare operational costs and complexity", status: "completed" },
        ], createdAt: stepTs(6) },
        { id: "mv-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "postgres materialized views concurrent refresh performance analytics dashboard", createdAt: stepTs(8) },
        { id: "mv-step-6", kind: "tool-result", content: "Found several relevant results:\n- PostgreSQL docs: REFRESH MATERIALIZED VIEW CONCURRENTLY allows reads during refresh\n- Benchmark: materialized views reduce complex join queries from seconds to <100ms\n- pg_cron extension enables scheduled refresh without external scheduler\n- Unique index required for CONCURRENTLY option", createdAt: stepTs(10) },
        { id: "mv-step-7", kind: "text", content: "Materialized views look very promising for this use case. The `CONCURRENTLY` option means zero downtime during refresh, and pg_cron handles scheduling natively. Let me now check the Redis side for comparison.", createdAt: stepTs(12) },
        { id: "mv-step-8", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "redis caching strategy multi-table join analytics query cache invalidation patterns", createdAt: stepTs(14) },
        { id: "mv-step-9", kind: "tool-result", content: "Key findings on Redis for analytics caching:\n- Cache invalidation for multi-join queries is complex — need to invalidate on any underlying table change\n- Common pattern: event-driven invalidation with pub/sub, adds significant complexity\n- Managed Redis (ElastiCache) starts at ~$50/mo for production-grade\n- TTL-based invalidation simpler but risks serving stale data unpredictably\n- Additional monitoring needed: memory usage, eviction rates, connection pool", createdAt: stepTs(16) },
        { id: "mv-step-10", kind: "text", content: "## Recommendation: Materialized Views\n\nAfter researching both approaches for your analytics dashboard performance issue, **materialized views are the clear winner** for your use case.\n\n### Key Findings\n\n**Materialized Views (Postgres)**\n- Refresh time for your query volume: ~200ms with `REFRESH MATERIALIZED VIEW CONCURRENTLY`\n- Staleness: configurable refresh interval (recommend 5-minute cron)\n- Complexity: single `CREATE MATERIALIZED VIEW` + cron job\n- No additional infrastructure needed\n- Reduces 8s query to ~50ms read time\n\n**Redis Caching**\n- Adds operational complexity: Redis cluster, monitoring, failover\n- Cache invalidation is genuinely hard for multi-join analytics\n- TTL tuning required per query pattern\n- Additional $50-80/mo for managed Redis (ElastiCache)\n\n### Why Mat Views Win Here\n1. Your analytics data is inherently stale-tolerant — users check trends, not real-time counts\n2. Only 3 enterprise customers check analytics >2x/day (per Mixpanel)\n3. Zero new infrastructure to maintain\n4. Can always layer Redis on top later if needed\n\n### Implementation Plan\n1. Create materialized view for the 6-join analytics query\n2. Add `UNIQUE INDEX` for concurrent refresh support\n3. Set up pg_cron to refresh every 5 minutes\n4. Update API to read from view instead of running live query\n\nExpected result: **8s -> ~50ms** load time.", createdAt: stepTs(20) },
      ],
      createdAt: stepTs(0),
      completedAt: stepTs(22),
    },

    // Agent 2: Draft postmortem (MEETING)
    {
      id: "demo-agent-postmortem",
      kind: "analysis",
      taskId: MEETING_TASK_IDS.postmortem,
      sessionId: MEETING_SESSION_ID,
      task: "Draft incident postmortem for webhook processor outage",
      taskContext: "Webhook processor went down for 45 minutes last Wednesday. Root cause: migration locked webhooks table. Stripe events were lost but recovered via replay. No alerting on queue depth.",
      status: "completed",
      result: "## Incident Postmortem: Webhook Processor Outage\n\n**Date:** Wednesday, March 5, 2026\n**Duration:** 45 minutes (14:23 - 15:08 UTC)\n**Severity:** P1 — Customer-facing data processing failure\n**Author:** Jake (draft), reviewed by team\n\n### Summary\nA database migration deployed to production locked the `webhooks` table, causing the webhook processor queue to back up and eventually fail. Approximately 340 Stripe webhook events were not processed during the outage window. All events were recovered via Stripe's event replay API.\n\n### Timeline\n- **14:15** — Jake deploys migration adding index to `webhooks` table\n- **14:23** — First webhook processing failure (table locked during index creation)\n- **14:23-15:02** — Queue silently backs up; no alerts fire\n- **15:02** — Customer emails support about failed payment confirmation\n- **15:05** — Jake identifies locked table, kills migration process\n- **15:08** — Queue drains, processing resumes\n- **15:30** — All 340 missed events replayed via Stripe API\n\n### Root Cause\nThe migration used `CREATE INDEX` instead of `CREATE INDEX CONCURRENTLY`, which locks the table for the duration of index creation. On the webhooks table (~2M rows), this took approximately 40 minutes.\n\n### Impact\n- 340 webhook events delayed by 45 minutes\n- 3 customers experienced delayed payment confirmations\n- 1 enterprise prospect (fintech company) was affected\n- No permanent data loss — all events recovered\n\n### Action Items\n1. **[P0] Add queue depth alerting** — Alert when webhook queue exceeds 100 items or 5-minute processing delay\n2. **[P0] Migration safety checklist** — All migrations must use `CONCURRENTLY` for index operations on tables >10K rows\n3. **[P1] Dead letter queue** — Failed webhooks should be retried automatically, not dropped\n4. **[P2] Staging migration testing** — Run all migrations against production-sized dataset in staging first\n\n### Lessons Learned\n- Silent failures are worse than loud failures. The 40-minute gap between failure and detection was the real problem.\n- Migration safety should be enforced by tooling, not just code review.",
      steps: [
        { id: "pm-step-1", kind: "user", content: "Draft incident postmortem for webhook processor outage", createdAt: stepTs(25) },
        { id: "pm-step-2", kind: "thinking", content: "I need to draft a postmortem for the webhook processor outage. From the meeting transcript, I know: 45 minutes downtime, migration locked webhooks table, Stripe events lost but recovered, no alerting on queue depth. Let me search for more context in the transcript.", createdAt: stepTs(27) },
        { id: "pm-step-3", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "webhook outage migration postmortem stripe events", createdAt: stepTs(29) },
        { id: "pm-step-4", kind: "tool-result", content: "Found relevant transcript excerpts:\n- \"we need to do a postmortem on last Wednesday's incident. The one where the webhook processor went down for 45 minutes and we lost a batch of Stripe events.\"\n- \"I deployed a migration that locked the webhooks table and the queue backed up. I already wrote up a draft postmortem.\"\n- \"Stripe has that event replay feature so we re-fetched everything. But it exposed that we don't have any alerting on queue depth.\"\n- \"I literally didn't know it was down until a customer emailed.\"", createdAt: stepTs(31) },
        { id: "pm-step-5", kind: "text", content: "## Incident Postmortem: Webhook Processor Outage\n\n**Date:** Wednesday, March 5, 2026\n**Duration:** 45 minutes (14:23 - 15:08 UTC)\n**Severity:** P1 — Customer-facing data processing failure\n**Author:** Jake (draft), reviewed by team\n\n### Summary\nA database migration deployed to production locked the `webhooks` table, causing the webhook processor queue to back up and eventually fail. Approximately 340 Stripe webhook events were not processed during the outage window. All events were recovered via Stripe's event replay API.\n\n### Timeline\n- **14:15** — Jake deploys migration adding index to `webhooks` table\n- **14:23** — First webhook processing failure (table locked during index creation)\n- **14:23-15:02** — Queue silently backs up; no alerts fire\n- **15:02** — Customer emails support about failed payment confirmation\n- **15:05** — Jake identifies locked table, kills migration process\n- **15:08** — Queue drains, processing resumes\n- **15:30** — All 340 missed events replayed via Stripe API\n\n### Root Cause\nThe migration used `CREATE INDEX` instead of `CREATE INDEX CONCURRENTLY`, which locks the table for the duration of index creation. On the webhooks table (~2M rows), this took approximately 40 minutes.\n\n### Impact\n- 340 webhook events delayed by 45 minutes\n- 3 customers experienced delayed payment confirmations\n- 1 enterprise prospect (fintech company) was affected\n- No permanent data loss — all events recovered\n\n### Action Items\n1. **[P0] Add queue depth alerting** — Alert when webhook queue exceeds 100 items or 5-minute processing delay\n2. **[P0] Migration safety checklist** — All migrations must use `CONCURRENTLY` for index operations on tables >10K rows\n3. **[P1] Dead letter queue** — Failed webhooks should be retried automatically, not dropped\n4. **[P2] Staging migration testing** — Run all migrations against production-sized dataset in staging first\n\n### Lessons Learned\n- Silent failures are worse than loud failures. The 40-minute gap between failure and detection was the real problem.\n- Migration safety should be enforced by tooling, not just code review.", createdAt: stepTs(35) },
      ],
      createdAt: stepTs(25),
      completedAt: stepTs(37),
    },

    // Agent 3: Compare monitoring tools (MEETING)
    {
      id: "demo-agent-monitoring",
      kind: "analysis",
      taskId: MEETING_TASK_IDS.datadogPricing,
      sessionId: MEETING_SESSION_ID,
      task: "Compare monitoring tools — Datadog vs Grafana Cloud vs New Relic",
      taskContext: "Team has been running Datadog and Grafana in staging. Datadog APM tracing is better but costs more. 6 hosts. Need to make a final decision.",
      status: "completed",
      result: "## Monitoring Tool Comparison\n\n### Pricing (6 hosts, APM + logs + metrics)\n\n| Feature | Datadog | Grafana Cloud | New Relic |\n|---------|---------|---------------|----------|\n| APM/host/mo | $31 | $0 (OSS) / $13 (Cloud Pro) | $0 (100GB free) |\n| Infra/host/mo | $15 | Included | Included |\n| Logs (100GB/mo) | $12.70/GB | $0.50/GB | $0.35/GB |\n| **Monthly total** | **~$408** | **~$128** | **~$85** |\n\n### Qualitative Assessment\n\n**Datadog** — Best DX, highest cost\n- Auto-instrumentation for Node.js is excellent (dd-trace)\n- APM distributed tracing works out of the box\n- Dashboard building is fast and intuitive\n- Alert management is best-in-class\n- Downside: costs add up fast as you scale\n\n**Grafana Cloud** — Cheapest, most maintenance\n- Open-source dashboards are powerful but require manual setup\n- Team currently spending ~4 hrs/week on dashboard maintenance\n- No built-in APM — need Tempo + manual instrumentation\n- Great for teams with dedicated DevOps; less ideal for a 4-person eng team\n\n**New Relic** — Middle ground\n- Generous free tier (100GB/mo) covers most startups\n- APM is solid but auto-instrumentation less mature than Datadog for Node.js\n- UI is improving but still cluttered compared to Datadog\n\n### Recommendation: Datadog\n\nDespite the higher cost, Datadog is the right choice for your team size and stage:\n1. **Engineering time savings** — 4 hrs/week on Grafana maintenance = ~$2,400/mo in eng time (at $150/hr fully loaded). Datadog's $408/mo is a bargain in comparison.\n2. **Auto-instrumentation** — Critical for a small team that can't afford to manually instrument everything\n3. **Incident response** — After the webhook outage, having APM + alerting that 'just works' is worth the premium\n4. **Scale consideration** — Re-evaluate at 20+ hosts; Datadog costs scale linearly while Grafana's are more predictable",
      steps: [
        { id: "mon-step-1", kind: "user", content: "Compare monitoring tools — Datadog vs Grafana Cloud vs New Relic", createdAt: stepTs(40) },
        { id: "mon-step-2", kind: "thinking", content: "The team has been debating Datadog vs Grafana for 3 sprints. They're currently running both in staging. Datadog APM is better but costs more. Let me do a thorough comparison with pricing and make a clear recommendation.", createdAt: stepTs(42) },
        { id: "mon-step-3", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "datadog pricing 2026 APM per host infrastructure monitoring cost", createdAt: stepTs(44) },
        { id: "mon-step-4", kind: "tool-result", content: "Datadog pricing (current):\n- Infrastructure: $15/host/month (Pro)\n- APM: $31/host/month\n- Log Management: $12.70/GB ingested (15-day retention)\n- Synthetics: from $5/1000 test runs\n- Enterprise plans available with volume discounts", createdAt: stepTs(46) },
        { id: "mon-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "grafana cloud pricing 2026 vs new relic free tier comparison startup", createdAt: stepTs(48) },
        { id: "mon-step-6", kind: "tool-result", content: "Grafana Cloud Pro: $13/user/month, includes Grafana, Loki (logs), Tempo (traces), Mimir (metrics). Free tier available with 10K metrics series.\n\nNew Relic: Free tier includes 100GB/month data ingest, 1 full platform user. Additional data at $0.35/GB. Full platform users $49/mo each.", createdAt: stepTs(50) },
        { id: "mon-step-7", kind: "todo", content: "Comparison checklist", todoItems: [
          { id: "mon-todo-1", content: "Compare pricing for 6-host setup", status: "completed" },
          { id: "mon-todo-2", content: "Evaluate APM capabilities (auto-instrumentation, distributed tracing)", status: "completed" },
          { id: "mon-todo-3", content: "Factor in engineering time cost for each option", status: "completed" },
          { id: "mon-todo-4", content: "Write recommendation with scaling considerations", status: "completed" },
        ], createdAt: stepTs(52) },
        { id: "mon-step-8", kind: "text", content: "## Monitoring Tool Comparison\n\n### Pricing (6 hosts, APM + logs + metrics)\n\n| Feature | Datadog | Grafana Cloud | New Relic |\n|---------|---------|---------------|----------|\n| APM/host/mo | $31 | $0 (OSS) / $13 (Cloud Pro) | $0 (100GB free) |\n| Infra/host/mo | $15 | Included | Included |\n| Logs (100GB/mo) | $12.70/GB | $0.50/GB | $0.35/GB |\n| **Monthly total** | **~$408** | **~$128** | **~$85** |\n\n### Recommendation: Datadog\n\nDespite the higher cost, Datadog is the right choice for your team:\n1. **Engineering time savings** — 4 hrs/week on Grafana = ~$2,400/mo in eng time\n2. **Auto-instrumentation** — Critical for a small team\n3. **Incident response** — After webhook outage, APM + alerting that 'just works' is worth the premium", createdAt: stepTs(56) },
      ],
      createdAt: stepTs(40),
      completedAt: stepTs(58),
    },

    // Agent 4: Create itinerary doc (TRIP session)
    {
      id: "demo-agent-itinerary",
      kind: "analysis",
      taskId: TRIP_TASK_IDS.itinerary,
      sessionId: TRIP_SESSION_ID,
      task: "Create shared Google Doc for Japan trip itinerary",
      taskContext: "Group planning 10-day Japan trip April 5-15. Need day-by-day itinerary with hotel bookings, restaurants, trains. Danny volunteered to make the doc.",
      status: "completed",
      result: "## Japan Trip Itinerary — April 5-15, 2026\n\nI've drafted a comprehensive day-by-day itinerary based on everything discussed in your planning session. Here's the structure:\n\n### Tokyo (April 5-9)\n- **Day 1 (Apr 5):** Arrive Haneda, check into Hotel Gracery Shinjuku, explore Kabukicho + Golden Gai (Albatross bar!)\n- **Day 2 (Apr 6):** Tsukiji Outer Market breakfast sushi, Senso-ji/Asakusa, Akihabara, Fuunji tsukemen for dinner\n- **Day 3 (Apr 7):** Shibuya Crossing, Harajuku/Meiji Shrine, Shibuya kaiten-zushi lunch, Shimokitazawa evening\n- **Day 4 (Apr 8):** TeamLab Borderless, Odaiba, Yakitori Alley (Yurakucho) dinner\n- **Day 5 (Apr 9):** Free morning for shopping, afternoon shinkansen to Hakone\n\n### Hakone (April 9-11)\n- **Day 5 evening:** Check into Hakone Ginyu ryokan, kaiseki dinner, private onsen\n- **Day 6 (Apr 10):** Hakone Open-Air Museum, Lake Ashi cruise, Owakudani black eggs\n- **Day 7 (Apr 11):** Morning onsen, check out, shinkansen to Kyoto\n\n### Kyoto (April 11-14)\n- **Day 7 evening:** Check into machiya, explore Gion district\n- **Day 8 (Apr 12):** Fushimi Inari (6 AM!), afternoon Nara day trip (deer park, Todai-ji)\n- **Day 9 (Apr 13):** Arashiyama bamboo grove, Kinkaku-ji, tea ceremony in Gion ($40/person)\n- **Day 10 (Apr 14):** Philosopher's Path, Nishiki Market, farewell dinner\n\n### Return (April 15)\n- **Day 11 (Apr 15):** Shinkansen to Tokyo, flight home from Haneda\n\n### Budget Per Person\n- Flights: $870 (ANA, booked)\n- Hotels: $730 (Gracery $300 + Machiya $150 + Ryokan $280)\n- JR Pass: $200\n- Food: $550 (~$50/day)\n- Activities: $150\n- **Total: ~$2,500**\n\nI'd normally create this in Notion or Google Docs, but I don't have access to your accounts. You can copy this into your shared doc and everyone can add their own notes!",
      steps: [
        { id: "itin-step-1", kind: "user", content: "Create shared Google Doc for Japan trip itinerary", createdAt: stepTs(60) },
        { id: "itin-step-2", kind: "thinking", content: "The group discussed a detailed Japan trip plan. I need to organize everything they discussed into a day-by-day itinerary. Let me search the transcript for all the specific details — dates, hotels, restaurants, activities, budget.", createdAt: stepTs(62) },
        { id: "itin-step-3", kind: "plan", content: "Itinerary plan", planTitle: "Itinerary Creation Plan", planContent: "1. Extract all dates, locations, hotels, and activities from the transcript\n2. Organize into a day-by-day format\n3. Include budget breakdown\n4. Try to create a Notion page via MCP if available, otherwise provide the formatted itinerary", planApprovalState: "approved", createdAt: stepTs(64) },
        { id: "itin-step-4", kind: "tool-call", content: "", toolName: "searchMcpTools", toolInput: "notion create page document", createdAt: stepTs(66) },
        { id: "itin-step-5", kind: "tool-result", content: "Available MCP tools:\n- notion:createPage - Create a new page in a Notion database\n- notion:updatePage - Update an existing Notion page\n- notion:searchPages - Search for pages in Notion\n\nNote: Notion MCP integration is available but requires authentication.", createdAt: stepTs(68) },
        { id: "itin-step-6", kind: "tool-call", content: "", toolName: "callMcpTool", toolInput: JSON.stringify({ provider: "notion", tool: "createPage", input: { title: "Japan Trip Itinerary — April 5-15, 2026", content: "Day-by-day itinerary for 10-day Japan trip" } }), createdAt: stepTs(70) },
        { id: "itin-step-7", kind: "tool-result", content: "Notion page created successfully.\nTitle: Japan Trip Itinerary — April 5-15, 2026\nURL: https://notion.so/japan-trip-itinerary-2026\n\nNote: This is a demo — the page was simulated for the onboarding experience.", createdAt: stepTs(72) },
        { id: "itin-step-8", kind: "text", content: "## Japan Trip Itinerary — April 5-15, 2026\n\nI've drafted a comprehensive day-by-day itinerary based on everything discussed in your planning session.\n\n### Tokyo (April 5-9)\n- **Day 1:** Arrive Haneda, Hotel Gracery Shinjuku, Golden Gai\n- **Day 2:** Tsukiji breakfast, Asakusa, Fuunji tsukemen\n- **Day 3:** Shibuya, Harajuku, kaiten-zushi\n- **Day 4:** TeamLab, Yakitori Alley dinner\n- **Day 5:** Shopping, shinkansen to Hakone\n\n### Hakone (April 9-11)\n- Hakone Ginyu ryokan, kaiseki dinner, private onsen\n- Open-Air Museum, Lake Ashi, Owakudani\n\n### Kyoto (April 11-14)\n- Machiya accommodation\n- Fushimi Inari 6 AM, Nara day trip\n- Arashiyama, Kinkaku-ji, tea ceremony\n\n### Budget: ~$2,500/person all-in", createdAt: stepTs(76) },
      ],
      createdAt: stepTs(60),
      completedAt: stepTs(78),
    },

    // Agent 5: Compare flights (TRIP session)
    {
      id: "demo-agent-flights",
      kind: "analysis",
      taskId: TRIP_TASK_IDS.flights,
      sessionId: TRIP_SESSION_ID,
      task: "Compare round-trip flights SFO to Tokyo for April 5-15",
      taskContext: "Group of 4 flying SFO to Tokyo. Discussed ANA ($870), JAL ($890), Zipair ($640 budget), United ($780). Prefer comfort but open to budget. ANA sale ends Tuesday.",
      status: "completed",
      result: "## Flight Comparison: SFO → Tokyo (April 5-15)\n\n| Airline | Price | Route | Duration | Bags | Seat Pitch | Meals |\n|---------|-------|-------|----------|------|-----------|-------|\n| **ANA** | **$870** | SFO→HND direct | 11h 15m | 2 checked | 34\" | Full kaiseki-style |\n| JAL | $890 | SFO→NRT direct | 11h 30m | 2 checked | 33\" | Full Japanese/Western |\n| United | $780 | SFO→NRT direct | 11h 20m | 1 checked | 31\" | Basic economy meal |\n| Zipair | $640 | SFO→NRT direct | 11h 30m | None included | 31\" | Buy onboard |\n\n### Recommendation: ANA at $870\n\n1. **Best value for comfort** — 2 free checked bags saves ~$120 vs United/Zipair, narrowing the real price gap\n2. **Haneda airport** — 30 min to Shinjuku vs 90 min from Narita (saves $30+ in transit per person)\n3. **Sale ends Tuesday** — current $870 is historically low; these routes averaged $1,100 last year\n4. **Service quality** — ANA consistently ranks top 5 globally for economy class\n\n### True Cost Comparison (including bags + transit)\n| | ANA | JAL | United | Zipair |\n|---|---|---|---|---|\n| Ticket | $870 | $890 | $780 | $640 |\n| Bags | $0 | $0 | +$70 | +$120 |\n| Airport→Hotel | ~$8 | ~$30 | ~$30 | ~$30 |\n| **Real total** | **$878** | **$920** | **$880** | **$790** |\n\nZipair saves ~$88/person but with no meals, tight seats, and Narita transit hassle for 4 people — not worth it for an 11-hour flight.",
      steps: [
        { id: "fl-step-1", kind: "user", content: "Compare round-trip flights SFO to Tokyo for April 5-15", createdAt: stepTs(80) },
        { id: "fl-step-2", kind: "thinking", content: "Need to compare ANA, JAL, United, and Zipair for the group's April dates. Should factor in total cost including bags and airport transit since Haneda vs Narita makes a real difference.", createdAt: stepTs(82) },
        { id: "fl-step-3", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "ANA flight SFO to Haneda April 2026 round trip price economy", createdAt: stepTs(84) },
        { id: "fl-step-4", kind: "tool-result", content: "ANA NH7 SFO→HND: $870 round trip (sale price, ends March 18). Direct flight, 11h 15m. 2 checked bags included. Economy seat pitch 34\".", createdAt: stepTs(86) },
        { id: "fl-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "JAL United Zipair SFO Tokyo April 2026 economy comparison", createdAt: stepTs(88) },
        { id: "fl-step-6", kind: "tool-result", content: "JAL JL1 SFO→NRT: $890, United UA837 SFO→NRT: $780 (1 bag), Zipair ZG22 SFO→NRT: $640 (no bags, no meals).", createdAt: stepTs(90) },
        { id: "fl-step-7", kind: "text", content: "## Recommendation: ANA at $870\n\nBest value when you factor in bags, Haneda transit savings, and service quality. Sale ends Tuesday — book now.", createdAt: stepTs(94) },
      ],
      createdAt: stepTs(80),
      completedAt: stepTs(96),
    },

    // Agent 6: Research ryokan options (TRIP session)
    {
      id: "demo-agent-ryokan",
      kind: "analysis",
      taskId: TRIP_TASK_IDS.ryokan,
      sessionId: TRIP_SESSION_ID,
      task: "Research and compare Hakone ryokans with private onsen",
      taskContext: "Budget under $300/night. Must have private onsen. Group mentioned Hakone Ginyu. Two rooms, two nights for 4 people.",
      status: "completed",
      result: "## Hakone Ryokan Comparison\n\n| Ryokan | Price/night | Private Onsen | Kaiseki Dinner | Rating | Availability |\n|--------|-----------|--------------|----------------|--------|-------------|\n| **Hakone Ginyu** | **$280** | ✅ Balcony | ✅ Included | 4.7/5 | Apr 9-11 ✅ |\n| Yama no Chaya | $320 | ✅ In-room | ✅ Included | 4.8/5 | Apr 9-11 ✅ |\n| Senkyoro | $180 | ✅ Shared private | ✅ Included | 4.3/5 | Apr 9-11 ✅ |\n| Gora Kadan | $800 | ✅ Suite | ✅ Multi-course | 4.9/5 | ❌ Sold out |\n| Fukuzumiro | $150 | ❌ Shared only | ❌ Optional | 4.1/5 | Apr 9-11 ✅ |\n\n### Recommendation: Hakone Ginyu\n\n**Best balance of experience and value:**\n- Private open-air onsen on each room's balcony (the dream)\n- Multi-course kaiseki dinner + traditional breakfast included\n- 2 rooms × 2 nights = $1,120 total → **$280/person**\n- Mountain valley views, 15 min from Hakone-Yumoto station\n\nYama no Chaya is slightly nicer but $320/night pushes total to $320/person. Senkyoro is cheaper but the private onsen is shared (book a slot) rather than in-room.\n\n### Booking Notes\n- April is peak season — book THIS WEEK\n- Cancellation: free up to 7 days before\n- Check-in 3pm, check-out 10am\n- They arrange shuttle from Hakone-Yumoto station",
      steps: [
        { id: "ry-step-1", kind: "user", content: "Research and compare Hakone ryokans with private onsen", createdAt: stepTs(100) },
        { id: "ry-step-2", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "Hakone ryokan private onsen April 2026 availability under $300", createdAt: stepTs(102) },
        { id: "ry-step-3", kind: "tool-result", content: "Top results: Hakone Ginyu ($280/night, private balcony onsen), Yama no Chaya ($320), Senkyoro ($180, shared private), Gora Kadan ($800, sold out April).", createdAt: stepTs(104) },
        { id: "ry-step-4", kind: "text", content: "## Recommendation: Hakone Ginyu at $280/night\nPrivate balcony onsen, kaiseki dinner included. $280/person for 2 nights. Book this week — April is peak.", createdAt: stepTs(108) },
      ],
      createdAt: stepTs(100),
      completedAt: stepTs(110),
    },

    // Agent 7: Visa research (TRIP session)
    {
      id: "demo-agent-visa",
      kind: "analysis",
      taskId: TRIP_TASK_IDS.visa,
      sessionId: TRIP_SESSION_ID,
      task: "Research H-1B advance parole requirements for Japan travel",
      taskContext: "Priya is on H-1B visa and needs to check if she can re-enter the US after Japan trip. May need advance parole document. Trip is April 5-15.",
      status: "completed",
      result: "## H-1B Re-entry Requirements for Japan Trip\n\n### Short Answer\nPriya does **NOT** need Advance Parole if she has a valid H-1B visa stamp in her passport. She needs Advance Parole only if her H-1B was approved via change of status (I-797) without leaving the US to get a visa stamp.\n\n### Key Requirements\n1. **Valid H-1B visa stamp** in passport (not expired) → can re-enter freely\n2. **Valid passport** with 6+ months validity from return date (Priya confirmed valid through 2027 ✅)\n3. **I-797 Approval Notice** — bring original as backup\n4. **Recent pay stubs** (2-3 months) — proves ongoing employment\n5. **Employer letter** — confirms active H-1B status and return to work\n\n### If Visa Stamp is Expired\nIf Priya's H-1B visa stamp has expired but her I-797 status is current:\n- She'll need to get a new H-1B visa stamp at a US consulate (NOT in Japan — no US consulate appointments available on short notice)\n- Alternative: Apply for Advance Parole if she has a pending I-485 (green card application)\n- **Timeline concern**: Advance Parole takes 3-6 months to process — likely too late for April trip\n\n### Action Items for Priya\n1. Check if H-1B visa stamp in passport is still valid (not the I-797 expiry — the actual visa stamp)\n2. If valid → no additional documents needed beyond passport + I-797\n3. If expired → consult immigration lawyer ASAP about options\n4. Either way: bring I-797, recent pay stubs, and employer letter as backup\n\n### Japan-Specific Notes\n- Japan grants 90-day visa-free entry for US passport holders (but Priya may be on Indian passport)\n- If Indian passport: Japan tourist visa required — apply at Japanese consulate 2+ weeks before trip\n- Japan immigration does NOT check US re-entry eligibility",
      steps: [
        { id: "visa-step-1", kind: "user", content: "Research H-1B advance parole requirements for Japan travel", createdAt: stepTs(112) },
        { id: "visa-step-2", kind: "thinking", content: "Priya is on H-1B and worried about re-entry. I need to clarify the difference between advance parole and H-1B visa stamp — many people confuse these. Also need to check Japan entry requirements.", createdAt: stepTs(114) },
        { id: "visa-step-3", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "H-1B visa holder travel abroad re-entry advance parole requirements 2026", createdAt: stepTs(116) },
        { id: "visa-step-4", kind: "tool-result", content: "H-1B holders with valid visa stamp can re-enter freely. Advance Parole only needed if: (1) no valid visa stamp and (2) pending adjustment of status. Processing time: 3-6 months.", createdAt: stepTs(118) },
        { id: "visa-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "Japan tourist visa requirements Indian passport H-1B holder", createdAt: stepTs(120) },
        { id: "visa-step-6", kind: "tool-result", content: "Indian passport holders need a tourist visa for Japan. Apply at Japanese consulate, processing 5-7 business days. Required: passport, photo, itinerary, bank statement, employment letter.", createdAt: stepTs(122) },
        { id: "visa-step-7", kind: "text", content: "## Key Finding\nPriya likely does NOT need Advance Parole — just a valid H-1B visa stamp. But she may need a Japan tourist visa if on an Indian passport. Both are solvable but time-sensitive.", createdAt: stepTs(126) },
      ],
      createdAt: stepTs(112),
      completedAt: stepTs(128),
    },

    // Agent 8: API migration guide (MEETING session)
    {
      id: "demo-agent-migration",
      kind: "analysis",
      taskId: MEETING_TASK_IDS.migrationGuide,
      sessionId: MEETING_SESSION_ID,
      task: "Draft API migration guide for OAuth2 auth breaking changes",
      taskContext: "Sarah shipped OAuth2 with Google, GitHub, and magic link auth. Moving from session-based to token-based auth. API consumers need migration guide by Wednesday.",
      status: "completed",
      result: "## API Migration Guide: Auth v1 → v2 (OAuth2)\n\n### Breaking Changes Summary\n\n| Change | v1 (Current) | v2 (New) | Migration Effort |\n|--------|-------------|----------|------------------|\n| Auth mechanism | Session cookies | Bearer tokens (JWT) | Medium |\n| Login endpoint | `POST /auth/login` | `POST /auth/token` | Low |\n| Token format | Opaque session ID | JWT with claims | Low |\n| Refresh | Automatic (cookie) | Explicit `POST /auth/refresh` | Medium |\n| Logout | `POST /auth/logout` | Token expiry + optional revoke | Low |\n\n### Step-by-Step Migration\n\n**1. Update Authentication Headers**\n```diff\n- Cookie: session_id=abc123\n+ Authorization: Bearer eyJhbG...\n```\n\n**2. Replace Login Flow**\n```diff\n- POST /auth/login { email, password }\n+ POST /auth/token { grant_type: \"password\", email, password }\n  Response: { access_token, refresh_token, expires_in: 3600 }\n```\n\n**3. Implement Token Refresh**\n```javascript\n// Before: cookies auto-refresh\n// After: explicit refresh before expiry\nPOST /auth/refresh { refresh_token: \"...\" }\n→ { access_token: \"new...\", expires_in: 3600 }\n```\n\n**4. Handle New Error Codes**\n- `401 Unauthorized` — token expired, refresh needed\n- `403 Forbidden` — valid token but insufficient scope\n- `429 Too Many Requests` — rate limit (new in v2)\n\n### Timeline\n- **Now → March 20**: v1 and v2 both active (feature flag)\n- **March 20 → April 3**: v1 deprecated, warning headers added\n- **April 3**: v1 endpoints removed\n\n### Known Edge Cases\n- Multi-tab token refresh: if two tabs refresh simultaneously, one will get a 401. Implement a token refresh mutex or use a shared service worker.\n- Mobile apps: store refresh token in secure storage, not localStorage.",
      steps: [
        { id: "mig-step-1", kind: "user", content: "Draft API migration guide for OAuth2 auth breaking changes", createdAt: stepTs(130) },
        { id: "mig-step-2", kind: "thinking", content: "Need to document the migration from session-based auth to OAuth2 JWT tokens. Should cover: endpoint changes, header changes, refresh flow, error codes, timeline, and the known multi-tab edge case.", createdAt: stepTs(132) },
        { id: "mig-step-3", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "OAuth2 auth migration breaking changes token refresh", createdAt: stepTs(134) },
        { id: "mig-step-4", kind: "tool-result", content: "Transcript excerpts:\n- \"Sarah shipped OAuth2 flow with Google, GitHub, and email magic link\"\n- \"Token refresh with multiple tabs open is a known edge case\"\n- \"We need the migration guide by Wednesday\"\n- \"Currently behind feature flag, ready for 100% rollout\"", createdAt: stepTs(136) },
        { id: "mig-step-5", kind: "text", content: "## API Migration Guide: Auth v1 → v2 (OAuth2)\n\nComplete guide covering endpoint changes, token format, refresh flow, error codes, timeline, and the multi-tab edge case. Ready for review.", createdAt: stepTs(140) },
      ],
      createdAt: stepTs(130),
      completedAt: stepTs(142),
    },
  ];
}

// ===========================================================================
// FINAL SUMMARY (MEETING session)
// ===========================================================================
function buildMeetingFinalSummary(baseTs: number) {
  return {
    narrative: "The team conducted a sprint review covering OAuth2 implementation (completed, behind feature flag), Stripe invoicing (blocked on legal), and dashboard redesign (done but with an 8-second analytics page load time that's generating customer complaints). Sprint planning prioritized OAuth2 rollout, dashboard performance fix using materialized views, and Stripe completion once unblocked. The team decided to adopt Datadog over Grafana Cloud for monitoring, and agreed to allocate 20% of sprint capacity to tech debt. A webhook processor outage postmortem was discussed — the incident exposed missing queue depth alerting. The team also agreed they urgently need to hire a mid-level backend engineer to reduce single-point-of-failure risk on Sarah.",
    agreements: [
      "Adopt Datadog for monitoring — better APM tracing justifies cost premium over Grafana Cloud",
      "Use materialized views (not Redis) for dashboard analytics performance fix",
      "Allocate 20% of sprint capacity to tech debt going forward",
      "Hire a mid-level backend engineer (Node + Postgres) — open req immediately",
      "Establish 24-hour PR review SLA to prevent reviews from stalling",
    ],
    missedItems: [
      "No concrete timeline for OAuth2 multi-tab token refresh edge case — could bite in production",
      "Tech debt items weren't prioritized — 20% allocation without a ranked backlog risks spreading effort thin",
      "No discussion of customer communication plan for the webhook outage or the slow dashboard",
    ],
    unansweredQuestions: [
      "What's the actual analytics page usage frequency? Marcus was going to pull Mixpanel data",
      "When will legal sign off on Stripe tax calculation? No ETA despite week-long delay",
      "What's the rollback plan if OAuth2 rollout causes issues at 100%?",
    ],
    agreementTodos: [
      { text: "Configure Datadog APM agent for all 6 production hosts", doer: "agent" as const },
      { text: "Create materialized view for the analytics dashboard query", doer: "agent" as const },
      { text: "Draft mid-level backend engineer job description", doer: "human" as const },
      { text: "Set up PR review rotation with 24-hour SLA enforcement", doer: "human" as const },
    ],
    missedItemTodos: [
      { text: "File ticket for OAuth2 multi-tab token refresh edge case with repro steps", doer: "agent" as const },
      { text: "Create prioritized tech debt backlog in Linear with effort estimates", doer: "human" as const },
      { text: "Draft customer communication about dashboard performance improvements", doer: "agent" as const },
    ],
    unansweredQuestionTodos: [
      { text: "Follow up with Marcus on Mixpanel analytics page usage data", doer: "human" as const },
      { text: "Escalate Stripe legal approval with specific deadline request", doer: "human" as const },
      { text: "Document OAuth2 rollout plan with rollback criteria and monitoring checklist", doer: "agent" as const },
    ],
    actionItems: [
      { text: "Share webhook processor postmortem with team today", doer: "human" as const },
      { text: "Update Jake's rate limiter PR with sliding window approach", doer: "human" as const },
      { text: "Write API migration guide for auth breaking changes by Wednesday", doer: "human" as const },
    ],
    generatedAt: baseTs + 80_000,
  };
}

// ===========================================================================
// AGENTS FLEET SUMMARY (MEETING session)
// ===========================================================================
function buildMeetingAgentsSummary(baseTs: number) {
  return {
    overallNarrative: "Four agents completed research and documentation tasks from the sprint review meeting. The materialized views agent recommended Postgres mat views over Redis (8s → 50ms, zero new infra). The postmortem agent drafted a comprehensive incident report for the webhook outage. The monitoring agent delivered a cost-benefit analysis confirming Datadog as the right choice. The migration guide agent produced a complete API migration document for the OAuth2 transition. Together, these agents saved approximately 4-5 hours of manual work.",
    agentHighlights: [
      {
        agentId: "demo-agent-matviews",
        task: "Research materialized views vs Redis caching",
        status: "completed" as const,
        keyFinding: "Materialized views will reduce the 8-second analytics query to ~50ms with zero new infrastructure. Redis adds $50-80/mo and cache invalidation complexity that's not worth it at current scale.",
      },
      {
        agentId: "demo-agent-postmortem",
        task: "Draft webhook processor outage postmortem",
        status: "completed" as const,
        keyFinding: "Root cause was non-concurrent index creation locking the webhooks table. Key action item: add queue depth alerting to prevent 40-minute detection gaps.",
      },
      {
        agentId: "demo-agent-monitoring",
        task: "Compare Datadog vs Grafana Cloud vs New Relic",
        status: "completed" as const,
        keyFinding: "Datadog costs $408/mo vs Grafana's $128/mo, but the 4 hrs/week Grafana maintenance ($2,400/mo in eng time) makes Datadog the clear ROI winner for a 4-person team.",
      },
      {
        agentId: "demo-agent-migration",
        task: "Draft API migration guide for OAuth2 auth changes",
        status: "completed" as const,
        keyFinding: "Complete migration guide covering session→JWT transition, new endpoints, token refresh flow, error codes, and a phased rollout timeline with v1 deprecation by April 3.",
      },
    ],
    coverageGaps: [
      "No agent investigated the OAuth2 multi-tab token refresh edge case — this could use dedicated testing",
      "The Stripe invoicing blocker (legal approval) wasn't addressed since it requires human escalation",
    ],
    nextSteps: [
      "Implement the materialized view based on the research recommendation — estimated 1 day of work",
      "Share the postmortem draft with the team and schedule a 30-minute review meeting",
      "Begin Datadog setup using the pricing tier recommended by the monitoring agent",
      "Review and distribute the API migration guide to API consumers before Wednesday",
    ],
    generatedAt: baseTs + 85_000,
    totalAgents: 4,
    succeededAgents: 4,
    failedAgents: 0,
    totalDurationSecs: 240,
  };
}

// ===========================================================================
// AGENTS FLEET SUMMARY (TRIP session)
// ===========================================================================
function buildTripAgentsSummary(baseTs: number) {
  return {
    overallNarrative: "Four agents tackled the key logistics for the Japan trip. The itinerary agent created a comprehensive day-by-day plan with a Notion doc. The flights agent compared all carrier options and confirmed ANA at $870 is the best value. The ryokan agent found Hakone Ginyu as the ideal pick with private onsen at $280/night. The visa agent clarified that Priya likely doesn't need Advance Parole but may need a Japan tourist visa. All critical booking decisions now have data backing them.",
    agentHighlights: [
      {
        agentId: "demo-agent-itinerary",
        task: "Create shared itinerary document",
        status: "completed" as const,
        keyFinding: "Complete day-by-day itinerary covering Tokyo (5 days), Hakone (2 days), Kyoto (3 days) with budget breakdown of ~$2,500/person all-in.",
      },
      {
        agentId: "demo-agent-flights",
        task: "Compare round-trip flights SFO to Tokyo",
        status: "completed" as const,
        keyFinding: "ANA at $870 is best value when factoring in bags and Haneda transit savings. True cost gap vs budget Zipair is only ~$88 for 11 hours of comfort.",
      },
      {
        agentId: "demo-agent-ryokan",
        task: "Research Hakone ryokans with private onsen",
        status: "completed" as const,
        keyFinding: "Hakone Ginyu: $280/night with private balcony onsen and kaiseki dinner. $280/person for 2 nights. April availability confirmed — book this week.",
      },
      {
        agentId: "demo-agent-visa",
        task: "Research H-1B visa requirements for Japan",
        status: "completed" as const,
        keyFinding: "Priya doesn't need Advance Parole if her H-1B visa stamp is valid. But she may need a Japan tourist visa on Indian passport — 5-7 business days processing.",
      },
    ],
    coverageGaps: [
      "No agent researched travel insurance options — important for international trip",
      "Luggage forwarding between cities (Yamato Transport) wasn't investigated",
    ],
    nextSteps: [
      "Book ANA flights immediately — sale ends Tuesday",
      "Reserve Hakone Ginyu this week before April availability fills up",
      "Priya: verify visa stamp status and apply for Japan tourist visa if needed",
      "Book the Kyoto machiya on Airbnb for April 11-14",
    ],
    generatedAt: baseTs + 95_000,
    totalAgents: 4,
    succeededAgents: 4,
    failedAgents: 0,
    totalDurationSecs: 200,
  };
}

// ===========================================================================
// AGENTS FLEET SUMMARY (BRAIN session)
// ===========================================================================
function buildBrainAgentsSummary(baseTs: number) {
  return {
    overallNarrative: "Four agents explored the AI recipe app concept from multiple angles. The competitive analysis revealed a genuine market gap — no app combines photo-based ingredient detection with multi-profile dietary matching. The MVP spec validated the 6-week timeline but flagged Spoonacular's 2-diet-type API limit as a technical risk. The domain check found supper.app available at $14/yr. The interview guide provides a structured approach to validate demand with 10 target users. The team now has enough data to make a go/no-go decision.",
    agentHighlights: [
      {
        agentId: "demo-agent-competitive",
        task: "Research competitive landscape for AI recipe apps",
        status: "completed" as const,
        keyFinding: "No competitor offers photo-based ingredient detection + multi-profile dietary matching. SuperCook is manual, Yummly is single-profile, Mealime has no fridge awareness. This is a genuinely open opportunity.",
      },
      {
        agentId: "demo-agent-mvp-spec",
        task: "Draft MVP feature spec",
        status: "completed" as const,
        keyFinding: "6-week timeline is feasible. Key risk: Spoonacular API limits compound dietary filters to 2 types per query — need client-side post-filtering for complex households.",
      },
      {
        agentId: "demo-agent-domains",
        task: "Check domain availability",
        status: "completed" as const,
        keyFinding: "supper.app available at $14/yr. mise.app taken. Recommend registering supper.app + getsupper.com ($26/yr total). Social handles @supperapp available on Twitter and Instagram.",
      },
      {
        agentId: "demo-agent-interview-guide",
        task: "Create user interview guide",
        status: "completed" as const,
        keyFinding: "30-minute structured interview covering current behavior, pain points, concept validation, and willingness to pay. Screening criteria for 5 parents + 5 young professionals.",
      },
    ],
    coverageGaps: [
      "No agent investigated data privacy implications of storing fridge photos (GDPR, user trust)",
      "Offline-first architecture for kitchen use (no connectivity) wasn't explored",
    ],
    nextSteps: [
      "Register supper.app and getsupper.com before someone else grabs them",
      "Start user interviews using the interview guide — aim for 10 interviews in 2 weeks",
      "Build photo recognition prototype to validate ingredient detection accuracy",
      "Test Spoonacular API compound filtering to confirm the workaround approach",
    ],
    generatedAt: baseTs + 85_000,
    totalAgents: 4,
    succeededAgents: 4,
    failedAgents: 0,
    totalDurationSecs: 220,
  };
}

// ===========================================================================
// AGENTS FLEET SUMMARY (STUDY session)
// ===========================================================================
function buildStudyAgentsSummary(baseTs: number) {
  return {
    overallNarrative: "Four agents produced comprehensive exam prep materials for distributed systems. The study guide provides a detailed Raft vs Paxos vs ZAB comparison with exam-style Q&A. The BFT review covers the 3f+1 proof intuition and PBFT protocol with practice problems. The uncommitted log entry trace walks through the exact scenario from the homework step by step. The vector clock solutions cover 4 key practice problems. Together, these materials cover all major exam topics identified during the study session.",
    agentHighlights: [
      {
        agentId: "demo-agent-study-guide",
        task: "Raft vs Paxos vs ZAB comparison",
        status: "completed" as const,
        keyFinding: "All three protocols require 2f+1 nodes. Raft wins on understandability (decomposed design), Paxos is more general (leaderless), ZAB optimizes for primary-ordered broadcasts. Key exam distinction: Raft guarantees no log gaps, Paxos allows them.",
      },
      {
        agentId: "demo-agent-bft-review",
        task: "Byzantine fault tolerance review",
        status: "completed" as const,
        keyFinding: "BFT needs 3f+1 nodes (vs 2f+1 for CFT) because faulty nodes can lie. PBFT has O(n²) message complexity — too expensive for most practical systems. 3 exam practice problems with solutions included.",
      },
      {
        agentId: "demo-agent-uncommitted",
        task: "Uncommitted log entry problem",
        status: "completed" as const,
        keyFinding: "Step-by-step trace: leader crashes after replicating to minority → entry is NOT committed → new leader may or may not have it → either outcome is safe because client never got confirmation.",
      },
      {
        agentId: "demo-agent-practice",
        task: "Vector clock practice problems",
        status: "completed" as const,
        keyFinding: "4 problems solved: causal ordering detection, conflicting write detection, Lamport vs vector clock limitations, and Raft behavior during network partitions.",
      },
    ],
    coverageGaps: [
      "Gossip protocols and consistent hashing were mentioned but not covered in depth",
      "Linearizability vs sequential consistency distinction needs more work",
    ],
    nextSteps: [
      "Review all 4 agent outputs before the exam — focus on the Q&A sections",
      "Ask professor whether CRDTs are in scope for the exam",
      "Do one more pass on the BFT practice problems without looking at solutions",
      "Read the Dynamo paper's vector clock section for real-world context",
    ],
    generatedAt: baseTs + 75_000,
    totalAgents: 4,
    succeededAgents: 4,
    failedAgents: 0,
    totalDurationSecs: 190,
  };
}

// ===========================================================================
// FINAL SUMMARY (TRIP session — lighter)
// ===========================================================================
function buildTripFinalSummary(baseTs: number) {
  return {
    narrative: "The group finalized plans for a 10-day Japan trip during cherry blossom season (April 5-15). Key decisions: ANA flights at $870/person from SFO to Haneda, Hotel Gracery Shinjuku for Tokyo (5 nights), Hakone Ginyu ryokan for 2 nights with private onsen, and a machiya rental in Kyoto for 3 nights. Total budget agreed at approximately $2,500 per person all-in. The group also discussed JR Pass logistics, food spots, and Kyoto activities including a tea ceremony. Priya needs to verify H-1B visa re-entry requirements.",
    agreements: [
      "Trip dates: April 5-15, 2026 (11 days, 10 nights)",
      "Book ANA flights at $870/person SFO to Haneda before Tuesday sale ends",
      "Hotel Gracery Shinjuku for Tokyo ($60/person/night), machiya in Kyoto ($50/person/night)",
      "Hakone Ginyu ryokan for 2 nights ($280/person including meals)",
      "Get 7-day JR Pass ($200/person) — Hikari trains acceptable",
      "Use eSIM (Ubigi or Airalo) instead of pocket WiFi",
    ],
    missedItems: [
      "No discussion of travel insurance — important for international trip",
      "Didn't discuss luggage strategy — storing bags during transit between cities",
      "No backup plan if Priya's visa situation doesn't work out",
    ],
    unansweredQuestions: [
      "Can Priya get advance parole for H-1B re-entry? Needs to check with immigration lawyer",
      "Are the preferred hotels and ryokan available for the selected dates?",
      "What's the group's stance on splitting up for some activities (different interests)?",
    ],
    agreementTodos: [
      { text: "Book ANA flights SFO-HND for April 5-15 before Tuesday", doer: "human" as const },
      { text: "Reserve Hakone Ginyu ryokan for April 9-11", doer: "human" as const },
      { text: "Book machiya in Kyoto on Airbnb for April 11-14", doer: "human" as const },
      { text: "Order JR Pass online for pickup at Haneda station", doer: "human" as const },
    ],
    missedItemTodos: [
      { text: "Research travel insurance options for 10-day Japan trip", doer: "agent" as const },
      { text: "Look into luggage forwarding services (Yamato Transport) for city-to-city transit", doer: "agent" as const },
    ],
    unansweredQuestionTodos: [
      { text: "Priya: call immigration lawyer Monday re: advance parole for H-1B", doer: "human" as const },
      { text: "Check Hotel Gracery Shinjuku availability for April 5-9", doer: "agent" as const },
    ],
    actionItems: [
      { text: "Create shared Google Doc with day-by-day itinerary", doer: "human" as const },
      { text: "Set up Splitwise group 'Japan 2026' and add everyone", doer: "human" as const },
      { text: "Download Navitime app for Japan transit navigation", doer: "human" as const },
    ],
    generatedAt: baseTs + 90_000,
  };
}

// ===========================================================================
// FINAL SUMMARY (BRAIN session)
// ===========================================================================
function buildBrainFinalSummary(baseTs: number) {
  return {
    narrative: "The team brainstormed an AI-powered recipe app concept that identifies fridge contents from photos and suggests meals matching household dietary restrictions. The key differentiator is multi-profile support — one meal that works for lactose intolerant, vegetarian, keto, etc. simultaneously. Competitive analysis showed gaps in existing apps (SuperCook is manual, Whisk is just bookmarking, Yummly is bloated). The business model combines freemium consumer pricing ($5.99/mo) with grocery affiliate revenue and B2B licensing. MVP scope was scoped to 6 weeks: photo ingredient detection, 2-profile dietary restrictions, and recipe matching. Top name candidates are 'Mise' and 'Supper'. Go-to-market strategy focuses on food TikTok/Reels content and 50 food blogger partnerships.",
    agreements: [
      "MVP scope: photo ingredient detection + 2-profile dietary matching + recipe suggestions — ship in 6 weeks",
      "Tech stack: multimodal LLM (Claude) for food recognition, Spoonacular API for recipes, USDA FoodData Central for nutrition",
      "Pricing: free tier (5 lookups/week), premium $5.99/mo (unlimited), annual $49.99",
      "Target market: dual-income households 25-40, parents overwhelmed by daily meal decisions",
      "Go-to-market: food TikTok/Reels content, Product Hunt launch, 50 food blogger partnerships",
    ],
    missedItems: [
      "No discussion of data privacy implications of storing fridge photos — important for user trust",
      "Didn't address offline mode — what happens when user has no connectivity in the kitchen?",
      "No accessibility considerations for users with visual impairments using the photo feature",
    ],
    unansweredQuestions: [
      "How accurate is photo-based ingredient detection in practice? Need prototype data",
      "What's the Spoonacular API rate limit and can it handle compound dietary filters?",
      "Is 6 weeks realistic for the MVP given the LLM integration complexity?",
    ],
    agreementTodos: [
      { text: "Build photo recognition prototype with Claude vision API", doer: "agent" as const },
      { text: "Set up Spoonacular API sandbox and test compound dietary filtering", doer: "agent" as const },
      { text: "Draft MVP feature spec with user stories and acceptance criteria", doer: "agent" as const },
    ],
    missedItemTodos: [
      { text: "Research food photo privacy best practices and GDPR implications", doer: "agent" as const },
      { text: "Evaluate offline-first architecture options for the mobile app", doer: "human" as const },
    ],
    unansweredQuestionTodos: [
      { text: "Run 50 test photos through Claude vision API and measure accuracy", doer: "human" as const },
      { text: "Check Spoonacular API compound filter support and document limitations", doer: "agent" as const },
    ],
    actionItems: [
      { text: "Check domain availability for mise.app and supper.app", doer: "human" as const },
      { text: "Interview 10 target users about meal planning pain points", doer: "human" as const },
      { text: "Create competitive analysis document with feature comparison matrix", doer: "agent" as const },
    ],
    generatedAt: baseTs + 80_000,
  };
}

// ===========================================================================
// FINAL SUMMARY (STUDY session)
// ===========================================================================
function buildStudyFinalSummary(baseTs: number) {
  return {
    narrative: "Study session covered distributed systems consensus protocols for exam prep. Deep comparison of Raft vs Paxos: Raft uses strong leader model with randomized election timeouts, while Paxos uses proposer/acceptor/learner roles with prepare/accept phases. Also covered CAP theorem tradeoffs (DynamoDB/Cassandra = AP, Spanner = CP), vector clocks vs Lamport clocks for causal ordering, and Byzantine fault tolerance (3f+1 requirement vs crash fault tolerance's 2f+1). Key exam focus areas identified: consensus protocol comparison, failure model assumptions, and the 2PC/3PC blocking problem. The uncommitted log entry scenario from homework needs more work.",
    agreements: [
      "Focus exam prep on: Raft vs Paxos comparison, CAP theorem tradeoffs, vector clocks, BFT vs CFT",
      "Create comprehensive comparison table for consensus protocols (Raft, Paxos, ZAB)",
      "Professor hinted Byzantine fault tolerance will be on the exam — prioritize BFT review",
      "Work through week 8 problem set independently then compare answers",
    ],
    missedItems: [
      "Didn't cover gossip protocols in detail — consistent hashing section was rushed",
      "No discussion of real-world case studies (e.g., Google Spanner, Amazon Dynamo paper)",
      "Skipped over the formal proof of why 3f+1 nodes needed for BFT",
    ],
    unansweredQuestions: [
      "How does ZAB (ZooKeeper) differ from Raft in practice? Need to review ZAB paper",
      "What's the exact difference between linearizability and sequential consistency?",
      "Will the exam cover CRDTs or just vector clocks for conflict resolution?",
    ],
    agreementTodos: [
      { text: "Create Raft vs Paxos vs ZAB comparison table with exam-relevant details", doer: "agent" as const },
      { text: "Complete week 8 problem set focusing on vector clocks and consensus", doer: "human" as const },
    ],
    missedItemTodos: [
      { text: "Review gossip protocol convergence properties and consistent hashing", doer: "human" as const },
      { text: "Read Dynamo and Spanner papers for real-world consensus examples", doer: "human" as const },
    ],
    unansweredQuestionTodos: [
      { text: "Research ZAB protocol and compare with Raft leader election", doer: "agent" as const },
      { text: "Ask professor whether CRDTs are in scope for the exam", doer: "human" as const },
    ],
    actionItems: [
      { text: "Solve the uncommitted log entry problem from homework", doer: "human" as const },
      { text: "Review Byzantine fault tolerance section and 3f+1 proof", doer: "human" as const },
    ],
    generatedAt: baseTs + 70_000,
  };
}

// ===========================================================================
// AGENTS (BRAIN session)
// ===========================================================================
function buildBrainAgents(baseTs: number): AgentSeed[] {
  const stepTs = (offset: number) => baseTs + offset * 1000;

  return [
    {
      id: "demo-agent-competitive",
      kind: "analysis",
      taskId: BRAIN_TASK_IDS.prototype,
      sessionId: BRAIN_SESSION_ID,
      task: "Research competitive landscape for AI recipe apps",
      taskContext: "Team brainstorming AI recipe app that identifies fridge contents from photos. Need to understand competitive landscape: SuperCook, Whisk, Yummly, Mealime, and any new AI-powered entrants.",
      status: "completed",
      result: "## AI Recipe App Competitive Landscape\n\n### Direct Competitors\n\n| App | AI Features | Dietary Profiles | Fridge Scan | Pricing | Weaknesses |\n|-----|------------|-----------------|-------------|---------|------------|\n| **SuperCook** | None | Basic filters | Manual input | Free | No AI, tedious manual entry |\n| **Whisk** (Samsung) | Basic suggestions | Single profile | No | Free | Bookmarking focus, no generation |\n| **Yummly** (Whirlpool) | Taste matching | Single profile | No | Free/$5/mo | Bloated UX, heavy ads on free tier |\n| **Mealime** | Meal planning | Basic restrictions | No | Free/$6/mo | No fridge awareness at all |\n| **SideChef** | Step-by-step video | Single profile | No | Free/$10/mo | Expensive, no ingredient detection |\n\n### Emerging AI Players\n- **Plant Jammer** — AI-powered flavor pairing, acquired by HelloFresh. Strong tech but B2B only now.\n- **DishGen** — GPT-powered recipe generation from ingredients (text input). No photo detection.\n- **Instacart AI** — Adding recipe suggestions but tied to their grocery platform.\n\n### Key Gap in Market\nNo app currently offers: **photo-based ingredient detection + multi-profile dietary matching**. This is a genuinely open opportunity.\n\n- SuperCook requires manual ingredient entry (friction)\n- Yummly/Mealime only support single-user dietary preferences\n- No competitor handles \"make one meal for a household with different dietary needs\"\n\n### Recommendation\nThe multi-profile household angle is the strongest differentiator. Lead marketing with: \"One photo. One meal. Every dietary need in your household.\" The photo detection is table stakes — the multi-profile matching is the moat.",
      steps: [
        { id: "comp-step-1", kind: "user", content: "Research competitive landscape for AI recipe apps", createdAt: stepTs(5) },
        { id: "comp-step-2", kind: "thinking", content: "I need to map the competitive landscape for AI recipe apps. The team mentioned SuperCook, Whisk, Yummly, and Mealime. Let me research each one and also look for emerging AI-powered competitors.", createdAt: stepTs(7) },
        { id: "comp-step-3", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "AI recipe app fridge photo ingredient detection 2026 competitive landscape", createdAt: stepTs(9) },
        { id: "comp-step-4", kind: "tool-result", content: "Found: SuperCook (manual ingredient input, free), Whisk by Samsung (recipe bookmarking), Yummly by Whirlpool (taste preferences), Mealime (meal planning), SideChef (guided cooking), Plant Jammer (acquired by HelloFresh), DishGen (GPT recipe generation from text)", createdAt: stepTs(11) },
        { id: "comp-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "multi-profile dietary restriction meal planning app household family", createdAt: stepTs(13) },
        { id: "comp-step-6", kind: "tool-result", content: "No existing apps found that handle multi-profile dietary restrictions for households. Most apps support single-user preferences only. Mealime has basic household support but only applies one set of restrictions.", createdAt: stepTs(15) },
        { id: "comp-step-7", kind: "text", content: "## AI Recipe App Competitive Landscape\n\nNo app currently offers photo-based ingredient detection + multi-profile dietary matching. This is a genuinely open opportunity.\n\n### Key Competitors: SuperCook (manual, free), Yummly ($5/mo, bloated), Mealime ($6/mo, no fridge scan), Whisk (bookmarking only)\n\n### Recommendation\nThe multi-profile household angle is the strongest differentiator. Lead with: \"One photo. One meal. Every dietary need in your household.\"", createdAt: stepTs(19) },
      ],
      createdAt: stepTs(5),
      completedAt: stepTs(21),
    },
    {
      id: "demo-agent-mvp-spec",
      kind: "analysis",
      taskId: BRAIN_TASK_IDS.spoonacular,
      sessionId: BRAIN_SESSION_ID,
      task: "Draft MVP feature spec for multi-profile dietary matching",
      taskContext: "AI recipe app MVP: photo ingredient detection, 2-profile dietary restrictions, recipe matching. Ship in 6 weeks. Tech: Claude vision API, Spoonacular API, USDA FoodData Central.",
      status: "completed",
      result: "## MVP Feature Spec: Multi-Profile Dietary Matching\n\n### Core User Flow\n1. **Photo Capture** — User photographs fridge contents\n2. **Ingredient Detection** — Claude vision API identifies ingredients with confidence scores\n3. **Profile Selection** — User selects which household profiles to match (max 2 for MVP)\n4. **Recipe Matching** — Spoonacular API filtered by combined dietary restrictions\n5. **Results** — Ranked recipe list with nutrition info per profile\n\n### Profile System (MVP)\n- Max 2 profiles per household\n- Supported restrictions: vegetarian, vegan, gluten-free, dairy-free, nut-free, pescatarian, keto, halal\n- Each profile has: name, avatar, dietary restrictions, allergies, disliked ingredients\n- Matching logic: intersection of safe ingredients across all active profiles\n\n### Technical Architecture\n```\nPhoto → Claude Vision API → Ingredient List (with confidence > 0.7)\n  → Spoonacular API (filtered by combined restrictions)\n  → Ranked results (by ingredient match %, cook time, rating)\n```\n\n### API Integration Details\n- **Claude Vision**: ~$0.01/photo at current pricing. Batch ingredient detection prompt.\n- **Spoonacular**: $30/mo for 150 req/day. `complexSearch` endpoint supports multiple dietary filters via `diet` and `intolerances` params. **Limitation**: max 2 diet types per query — need to post-filter for complex combos.\n- **USDA FoodData**: Free, no rate limit. Use for nutrition enrichment.\n\n### 6-Week Timeline\n- **Week 1-2**: Photo → ingredient detection pipeline. Prompt engineering + accuracy testing.\n- **Week 3**: Profile system + dietary restriction data model.\n- **Week 4**: Recipe matching engine with Spoonacular integration.\n- **Week 5**: UI/UX for core flow (React Native).\n- **Week 6**: Testing, edge cases, soft launch.\n\n### Success Metrics (MVP)\n- Ingredient detection accuracy > 80% on top 50 common fridge items\n- Recipe match rate > 90% (at least 3 recipes returned for any valid combo)\n- User task completion < 60 seconds (photo to recipe list)\n\n### Known Risks\n1. Spoonacular's 2-diet-type limit means complex households need client-side filtering\n2. Photo quality in kitchen lighting varies wildly — need robust prompt engineering\n3. 6-week timeline is tight if ingredient detection accuracy requires fine-tuning",
      steps: [
        { id: "mvp-step-1", kind: "user", content: "Draft MVP feature spec for multi-profile dietary matching", createdAt: stepTs(25) },
        { id: "mvp-step-2", kind: "thinking", content: "I need to create a detailed MVP spec covering the user flow, profile system, API integrations, and timeline. The team agreed on 6 weeks with photo detection, 2-profile restrictions, and recipe matching.", createdAt: stepTs(27) },
        { id: "mvp-step-3", kind: "plan", content: "MVP spec plan", planTitle: "MVP Spec Outline", planContent: "1. Define core user flow (photo → detect → match → results)\n2. Specify profile system constraints for MVP\n3. Document API integration details and limitations\n4. Create 6-week timeline\n5. Define success metrics", planApprovalState: "approved", createdAt: stepTs(29) },
        { id: "mvp-step-4", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "Spoonacular API complexSearch dietary filters multiple restrictions", createdAt: stepTs(31) },
        { id: "mvp-step-5", kind: "tool-result", content: "Spoonacular complexSearch supports: diet (comma-separated, max 2), intolerances (comma-separated), excludeIngredients. For >2 diet types, need to use includeIngredients + manual filtering. Rate limit: 150 points/day on $30/mo plan.", createdAt: stepTs(33) },
        { id: "mvp-step-6", kind: "text", content: "## MVP Feature Spec: Multi-Profile Dietary Matching\n\nCore flow: Photo → Claude Vision → Ingredient List → Spoonacular (filtered) → Ranked recipes\n\n### Key Finding\nSpoonacular has a 2-diet-type limit per query. For complex households (e.g., keto + dairy-free + pescatarian), we'll need client-side post-filtering.\n\n### 6-Week Timeline\nWeek 1-2: Photo detection pipeline\nWeek 3: Profile system\nWeek 4: Recipe matching\nWeek 5: UI\nWeek 6: Testing + launch", createdAt: stepTs(37) },
      ],
      createdAt: stepTs(25),
      completedAt: stepTs(39),
    },

    // Agent 3: Domain availability check (BRAIN session)
    {
      id: "demo-agent-domains",
      kind: "analysis",
      taskId: BRAIN_TASK_IDS.domains,
      sessionId: BRAIN_SESSION_ID,
      task: "Check domain availability for AI recipe app name candidates",
      taskContext: "Top name candidates are 'Mise' (mise en place) and 'Supper'. Need to check .app, .co, .com availability and pricing.",
      status: "completed",
      result: "## Domain Availability Report\n\n| Domain | Available | Price | Notes |\n|--------|-----------|-------|-------|\n| mise.app | ❌ Taken | — | Registered by a kitchen tools company |\n| supper.app | ✅ Available | $14/yr | Clean, matches the brand |\n| mise.co | ❌ Taken | — | Parked domain, asking $2,800 |\n| getsupper.com | ✅ Available | $12/yr | Good fallback |\n| supperapp.com | ✅ Available | $12/yr | Slightly redundant with .app |\n| usemise.com | ✅ Available | $12/yr | \"Use Mise\" — decent alternative |\n| miseapp.co | ✅ Available | $25/yr | Not ideal |\n\n### Recommendation\n**Primary: supper.app** ($14/yr) — clean, memorable, .app TLD signals mobile-first.\n**Backup: getsupper.com** ($12/yr) — classic .com for SEO and email.\n\nRegister both now — total $26/yr. mise.co is available for $2,800 if the team prefers 'Mise' but that's a lot for pre-revenue.\n\n### Social Media Handles\n- @supperapp — available on Twitter/X ✅\n- @supper.app — available on Instagram ✅\n- @supperapp — taken on TikTok ❌ (but @getsupperapp available)",
      steps: [
        { id: "dom-step-1", kind: "user", content: "Check domain availability for AI recipe app name candidates", createdAt: stepTs(42) },
        { id: "dom-step-2", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "mise.app domain availability supper.app domain check", createdAt: stepTs(44) },
        { id: "dom-step-3", kind: "tool-result", content: "mise.app: registered (kitchen tools company). supper.app: available $14/yr. mise.co: parked, $2,800. getsupper.com: available $12/yr.", createdAt: stepTs(46) },
        { id: "dom-step-4", kind: "text", content: "## Recommendation: supper.app ($14/yr)\nClean, available, .app TLD signals mobile-first. Register getsupper.com as backup. Both together: $26/yr.", createdAt: stepTs(50) },
      ],
      createdAt: stepTs(42),
      completedAt: stepTs(52),
    },

    // Agent 4: User interview guide (BRAIN session)
    {
      id: "demo-agent-interview-guide",
      kind: "analysis",
      taskId: BRAIN_TASK_IDS.interviews,
      sessionId: BRAIN_SESSION_ID,
      task: "Create user interview guide for meal planning pain point research",
      taskContext: "Need to interview 10 target users (5 parents, 5 young professionals) about meal planning. Focus on: decision process, frustrations, multi-profile dietary matching, willingness to pay.",
      status: "completed",
      result: "## User Interview Guide: Meal Planning Pain Points\n\n### Screening Criteria\n- **Parents (5):** Household of 3+, cook at home 4+ nights/week, at least one dietary restriction in household\n- **Young Professionals (5):** Ages 25-35, cook at home 3+ nights/week, health or diet-conscious\n\n### Interview Script (30 minutes)\n\n**Opening (2 min)**\n> Thanks for joining. We're exploring how people decide what to cook. No right/wrong answers — we want to learn from your real experience.\n\n**Current Behavior (8 min)**\n1. Walk me through how you decided what to cook for dinner last night?\n2. How far ahead do you typically plan meals? (Same day / 2-3 days / weekly)\n3. What sources do you use for recipe ideas? (Apps, social media, cookbooks, memory)\n4. How much time do you spend deciding what to cook vs actually cooking?\n\n**Pain Points (8 min)**\n5. What's the most frustrating part of meal planning for your household?\n6. Tell me about a time dietary restrictions made cooking harder. What happened?\n7. How do you handle different preferences in your household? (Probe: compromises, separate meals)\n8. What do you do when you open the fridge and don't know what to make?\n\n**Concept Validation (8 min)**\n9. *Show concept:* Imagine you take a photo of your fridge and an app suggests meals that work for everyone in your household — even with different diets. What's your first reaction?\n10. What would make you trust AI-suggested recipes? What would make you NOT trust them?\n11. How many dietary profiles would you need? (Self, partner, kids, guests)\n12. Would you use this daily, weekly, or only when stuck?\n\n**Willingness to Pay (4 min)**\n13. Do you currently pay for any food/recipe apps? Which ones and how much?\n14. If this app saved you 20 minutes of daily meal decisions, what would you pay monthly?\n15. What feature would make it a must-have vs nice-to-have?\n\n### Key Metrics to Track\n- Average time spent on meal decisions per day\n- Number of dietary restrictions per household\n- Current app usage and spending\n- Unprompted mentions of specific pain points\n- Reaction intensity to multi-profile concept (1-5 scale)",
      steps: [
        { id: "intv-step-1", kind: "user", content: "Create user interview guide for meal planning pain point research", createdAt: stepTs(55) },
        { id: "intv-step-2", kind: "thinking", content: "Need to design a structured interview that validates the core assumptions: (1) meal planning is a real pain point, (2) dietary restrictions compound the problem, (3) multi-profile matching would be valuable, (4) users would pay for it.", createdAt: stepTs(57) },
        { id: "intv-step-3", kind: "text", content: "## User Interview Guide\n\n30-minute structured interview covering current behavior, pain points, concept validation, and willingness to pay. Includes screening criteria for 5 parents + 5 young professionals.", createdAt: stepTs(61) },
      ],
      createdAt: stepTs(55),
      completedAt: stepTs(63),
    },
  ];
}

// ===========================================================================
// AGENTS (STUDY session)
// ===========================================================================
function buildStudyAgents(baseTs: number): AgentSeed[] {
  const stepTs = (offset: number) => baseTs + offset * 1000;

  return [
    {
      id: "demo-agent-study-guide",
      kind: "analysis",
      taskId: STUDY_TASK_IDS.comparison,
      sessionId: STUDY_SESSION_ID,
      task: "Create study guide comparing Raft vs Paxos consensus protocols",
      taskContext: "Distributed systems exam prep. Need detailed comparison of Raft and Paxos covering: leader model, fault tolerance, message complexity, liveness, real-world implementations. Also include ZAB for completeness.",
      status: "completed",
      result: "## Consensus Protocols Study Guide: Raft vs Paxos vs ZAB\n\n### Quick Reference Table\n\n| Property | Raft | Paxos (Multi) | ZAB (ZooKeeper) |\n|----------|------|---------------|------------------|\n| **Leader model** | Strong leader (all writes) | Proposer (any node) | Primary (all writes) |\n| **Election** | Randomized timeout | Prepare/promise phase | Prospective leader discovery |\n| **Log ordering** | Sequential, no gaps | Can have gaps | Sequential, no gaps |\n| **Fault tolerance** | 2f+1 nodes for f failures | 2f+1 nodes for f failures | 2f+1 nodes for f failures |\n| **Safety** | Always safe | Always safe | Always safe |\n| **Liveness** | Guaranteed (leader exists) | Not guaranteed (dueling proposers) | Guaranteed (primary exists) |\n| **Message complexity** | O(n) per operation | O(n) per operation (amortized) | O(n) per operation |\n| **Understandability** | Designed for it | Notoriously difficult | Moderate |\n| **Real implementations** | etcd, CockroachDB, TiKV | Chubby, Spanner (variant) | ZooKeeper, Kafka (KRaft replacing) |\n\n### Raft Deep Dive\n\n**Leader Election:**\n- Nodes start as followers with randomized election timeouts (150-300ms)\n- On timeout, node becomes candidate, increments term, votes for self\n- Sends RequestVote to all peers; wins with majority\n- **Key insight**: randomized timeouts prevent split votes in practice\n\n**Log Replication:**\n- Leader receives client request → appends to own log → sends AppendEntries to followers\n- Commits entry when majority acknowledges (including self)\n- **Election restriction**: candidate's log must be at least as up-to-date as voter's log\n- This ensures new leader always has all committed entries\n\n**Safety Proof Intuition:**\n- Leader Completeness: committed entries survive elections because majority overlap\n- State Machine Safety: all nodes apply same entries in same order\n\n### Paxos Deep Dive\n\n**Roles:** Proposer, Acceptor, Learner (nodes can play multiple roles)\n\n**Two Phases:**\n1. **Prepare (Phase 1a/1b):** Proposer sends prepare(n) → Acceptors promise not to accept proposals < n, return any previously accepted values\n2. **Accept (Phase 2a/2b):** Proposer sends accept(n, v) where v is the highest-numbered previously accepted value (or proposer's own value if none) → Acceptors accept if no higher prepare received\n\n**Why Paxos is Hard:**\n- Single-decree Paxos decides ONE value — need Multi-Paxos for a log\n- Multi-Paxos uses a stable leader to skip Phase 1 (optimization)\n- Gap handling: slots can be decided out of order → need gap-filling protocol\n- **Dueling proposers** can cause livelock (not safety violation)\n\n### ZAB Deep Dive\n\n**Phases:**\n1. **Discovery:** Nodes exchange epoch numbers, elect prospective leader\n2. **Synchronization:** Leader brings followers up to date\n3. **Broadcast:** Normal operation, leader proposes + 2-phase commit\n\n**Key Differences from Raft:**\n- ZAB separates recovery from normal operation more explicitly\n- Uses epoch-based protocol (similar to Raft terms)\n- Transaction ordering uses zxid (epoch + counter) vs Raft's (term + index)\n\n### Exam-Relevant Comparisons\n\n**Q: Why is Raft easier to understand than Paxos?**\nA: Raft decomposes consensus into leader election + log replication + safety. Paxos combines these into a single protocol. Raft's strong leader simplifies reasoning.\n\n**Q: When would you choose Paxos over Raft?**\nA: When you need leaderless operation (multi-datacenter with no single leader) or when the proposer role can rotate without election overhead.\n\n**Q: How does 2PC differ from consensus?**\nA: 2PC is a blocking protocol — coordinator crash blocks all participants. Consensus (Raft/Paxos) handles leader crash via re-election. 2PC guarantees agreement but not availability; consensus sacrifices availability only during partition.\n\n**Q: What's the FLP impossibility result?**\nA: No deterministic consensus protocol can guarantee termination in an asynchronous system with even one crash failure. Raft/Paxos work in practice because they use timeouts (partial synchrony assumption).",
      steps: [
        { id: "sg-step-1", kind: "user", content: "Create study guide comparing Raft vs Paxos consensus protocols", createdAt: stepTs(10) },
        { id: "sg-step-2", kind: "thinking", content: "I need to create a comprehensive study guide comparing Raft, Paxos, and ZAB. The student is prepping for a distributed systems exam, so I should focus on exam-relevant comparisons and include the kind of questions a professor would ask.", createdAt: stepTs(12) },
        { id: "sg-step-3", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "Raft Paxos consensus leader election log replication", createdAt: stepTs(14) },
        { id: "sg-step-4", kind: "tool-result", content: "Found relevant transcript excerpts:\n- \"Raft uses a strong leader model — all writes go through the leader\"\n- \"Paxos has three roles: proposer, acceptor, learner with prepare/accept phases\"\n- \"The key difference is Raft guarantees no log gaps while Paxos can have them\"\n- \"ZAB is similar to Raft but uses explicit recovery and synchronization phases\"", createdAt: stepTs(16) },
        { id: "sg-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "Raft vs Paxos vs ZAB comparison distributed consensus exam study guide", createdAt: stepTs(18) },
        { id: "sg-step-6", kind: "tool-result", content: "Key comparison points:\n- All require 2f+1 nodes for f crash failures\n- Raft: strong leader, randomized election, no log gaps\n- Paxos: any-proposer, prepare/accept, gaps allowed\n- ZAB: primary-based, epoch ordering, explicit recovery phase\n- FLP impossibility applies to all (overcome via partial synchrony)", createdAt: stepTs(20) },
        { id: "sg-step-7", kind: "todo", content: "Study guide checklist", todoItems: [
          { id: "sg-todo-1", content: "Create comparison table (leader model, fault tolerance, complexity)", status: "completed" },
          { id: "sg-todo-2", content: "Write Raft deep dive (election, replication, safety)", status: "completed" },
          { id: "sg-todo-3", content: "Write Paxos deep dive (phases, Multi-Paxos, dueling proposers)", status: "completed" },
          { id: "sg-todo-4", content: "Add ZAB comparison", status: "completed" },
          { id: "sg-todo-5", content: "Include exam-style Q&A section", status: "completed" },
        ], createdAt: stepTs(22) },
        { id: "sg-step-8", kind: "text", content: "## Consensus Protocols Study Guide: Raft vs Paxos vs ZAB\n\nComprehensive comparison table, deep dives on each protocol, and exam-relevant Q&A section included above.\n\n### Key Exam Tips:\n1. Raft is designed for understandability — decompose into subproblems\n2. Paxos is more general but harder to implement correctly\n3. 2PC ≠ consensus (blocking vs fault-tolerant)\n4. FLP impossibility is overcome by partial synchrony assumption (timeouts)", createdAt: stepTs(26) },
      ],
      createdAt: stepTs(10),
      completedAt: stepTs(28),
    },

    // Agent 2: BFT review (STUDY session)
    {
      id: "demo-agent-bft-review",
      kind: "analysis",
      taskId: STUDY_TASK_IDS.bft,
      sessionId: STUDY_SESSION_ID,
      task: "Create Byzantine fault tolerance review with exam-style problems",
      taskContext: "Professor hinted BFT will be on the exam. Cover BFT vs CFT, 3f+1 requirement, PBFT basics, why most systems avoid BFT.",
      status: "completed",
      result: "## Byzantine Fault Tolerance Review\n\n### BFT vs CFT (Crash Fault Tolerance)\n\n| Property | CFT | BFT |\n|----------|-----|-----|\n| Failure model | Node stops responding | Node sends arbitrary/malicious messages |\n| Nodes needed | 2f+1 for f failures | 3f+1 for f failures |\n| Examples | Raft, Paxos, ZAB | PBFT, Tendermint, HotStuff |\n| Performance | Fast (2 message delays) | Slow (3+ message delays) |\n| Use case | Trusted datacenter | Blockchain, untrusted environments |\n\n### Why 3f+1? (Intuition)\n- With Byzantine faults, faulty nodes can **lie** — send different values to different nodes\n- Need enough honest nodes to outvote liars AND detect contradictions\n- 2f+1 fails because f liars + f honest = 2f nodes could appear to agree on wrong value\n- 3f+1 ensures honest majority (2f+1) even when f nodes send conflicting messages\n\n### PBFT Protocol (Practical Byzantine Fault Tolerance)\n1. **Pre-prepare:** Primary broadcasts request with sequence number\n2. **Prepare:** Each replica broadcasts prepare message; wait for 2f+1 matching prepares\n3. **Commit:** Each replica broadcasts commit; wait for 2f+1 matching commits\n4. **Reply:** Execute and reply to client\n\nTotal messages per operation: O(n²) — this is why BFT is expensive!\n\n### Why Most Systems Avoid BFT\n1. **Performance:** O(n²) messages vs O(n) for Raft\n2. **Trust assumption:** If you control the datacenter, crash faults suffice\n3. **Complexity:** Much harder to implement correctly\n4. **Cost:** Need 3f+1 nodes instead of 2f+1 (50% more hardware)\n\n### Exam Practice Problems\n\n**Q1:** A system has 7 nodes. How many Byzantine faults can it tolerate?\n**A:** f = (7-1)/3 = 2 faults. (3f+1 = 7, so f = 2)\n\n**Q2:** Why can't we use 2PC in a Byzantine setting?\n**A:** 2PC assumes crash faults only. A Byzantine coordinator could send \"commit\" to some and \"abort\" to others, violating agreement.\n\n**Q3:** A blockchain network has 100 validators. 30 are compromised. Is the network safe?\n**A:** Need 3f+1 ≤ 100, so max f = 33. With 30 compromised: 30 < 33, so yes, the network is safe.",
      steps: [
        { id: "bft-step-1", kind: "user", content: "Create Byzantine fault tolerance review with exam-style problems", createdAt: stepTs(32) },
        { id: "bft-step-2", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "PBFT protocol explained Byzantine fault tolerance 3f+1 proof intuition", createdAt: stepTs(34) },
        { id: "bft-step-3", kind: "tool-result", content: "PBFT uses 3 phases: pre-prepare, prepare, commit. Requires 3f+1 nodes. O(n²) message complexity. Practical for small networks (< 20 nodes). Used in Hyperledger Fabric.", createdAt: stepTs(36) },
        { id: "bft-step-4", kind: "text", content: "## BFT Review Complete\nCovers BFT vs CFT comparison, 3f+1 proof intuition, PBFT protocol walkthrough, and 3 exam practice problems with solutions.", createdAt: stepTs(40) },
      ],
      createdAt: stepTs(32),
      completedAt: stepTs(42),
    },

    // Agent 3: Uncommitted log entry walkthrough (STUDY session)
    {
      id: "demo-agent-uncommitted",
      kind: "analysis",
      taskId: STUDY_TASK_IDS.uncommitted,
      sessionId: STUDY_SESSION_ID,
      task: "Solve the uncommitted log entry problem with step-by-step trace",
      taskContext: "Homework problem: leader crashes after replicating to minority. Trace through re-election and how new leader handles uncommitted entries in Raft.",
      status: "completed",
      result: "## Uncommitted Log Entry Problem: Step-by-Step Trace\n\n### Setup\n- 5-node Raft cluster: S1 (leader, term 2), S2, S3, S4, S5\n- S1 receives client write \"X=5\"\n- S1 appends to own log: `[term=2, index=3, X=5]`\n- S1 sends AppendEntries to S2, S3, S4, S5\n- **S2 receives and acks** ✅\n- S3, S4, S5 have NOT received it yet\n- **S1 crashes** 💥\n\n### State After Crash\n| Server | Log at index 3 | Status |\n|--------|----------------|--------|\n| S1 | `[t2, X=5]` | 💀 Crashed |\n| S2 | `[t2, X=5]` | Has entry (not committed) |\n| S3 | (empty) | No entry |\n| S4 | (empty) | No entry |\n| S5 | (empty) | No entry |\n\nThe entry is on 2 of 5 servers — **NOT committed** (needs majority = 3).\n\n### Re-election\n1. Election timeout fires on S3 (randomized timeout)\n2. S3 increments term to 3, votes for self\n3. S3 sends RequestVote to S2, S4, S5\n4. **Can S3 win?** Check election restriction:\n   - S3's log: last entry at index 2, term 1\n   - S2's log: last entry at index 3, term 2\n   - S2 will **reject** S3's vote (S3's log is less up-to-date)\n   - S4, S5 will **grant** votes (their logs ≤ S3's)\n   - S3 gets 3 votes (self + S4 + S5) → **S3 wins** ✅\n\n### What Happens to the Uncommitted Entry?\n5. S3 becomes leader (term 3)\n6. S3 sends AppendEntries to all — its log does NOT have `X=5`\n7. **S2's entry `[t2, X=5]` gets overwritten** by S3's new entries\n8. The uncommitted write is **lost forever**\n\n### Key Insight\nThis is **correct behavior** in Raft:\n- The client never received a commit confirmation\n- The entry was only on a minority (2/5)\n- Raft only guarantees committed entries survive elections\n- The client should retry the write with the new leader\n\n### Alternative Scenario: What if S2 Wins?\nIf S2 wins election instead (it has the most up-to-date log):\n- S2 becomes leader, keeps `[t2, X=5]` in its log\n- S2 replicates it to S3, S4, S5 as part of new term\n- Once replicated to majority → entry becomes committed\n- **The write survives** — but only because the new leader happened to have it\n\n### Exam Answer Template\n> An uncommitted entry (replicated to minority) may or may not survive leader failure. It depends on whether the new leader has the entry. This is safe because: (1) the client never got confirmation, (2) Raft's election restriction ensures committed entries always survive, and (3) uncommitted entries are explicitly not guaranteed.",
      steps: [
        { id: "uc-step-1", kind: "user", content: "Solve the uncommitted log entry problem with step-by-step trace", createdAt: stepTs(45) },
        { id: "uc-step-2", kind: "thinking", content: "This is a classic Raft safety question. I need to trace through exactly what happens when a leader crashes after replicating to only one follower. Key concepts: election restriction, commitment rule, and why uncommitted entries can be safely lost.", createdAt: stepTs(47) },
        { id: "uc-step-3", kind: "text", content: "## Complete Trace\n5-node cluster, leader crashes after replicating to 1 follower. Entry is uncommitted (2/5). New leader may or may not have it. Either outcome is safe because client never got confirmation.", createdAt: stepTs(51) },
      ],
      createdAt: stepTs(45),
      completedAt: stepTs(53),
    },

    // Agent 4: Practice problem solutions (STUDY session)
    {
      id: "demo-agent-practice",
      kind: "analysis",
      taskId: STUDY_TASK_IDS.practice,
      sessionId: STUDY_SESSION_ID,
      task: "Work through vector clock practice problems from week 8",
      taskContext: "Week 8 problem set focuses on vector clocks and consensus scenarios. Need to solve exercises and explain reasoning for exam prep.",
      status: "completed",
      result: "## Vector Clock Practice Problems — Solutions\n\n### Problem 1: Determine Causal Ordering\nThree processes P1, P2, P3. Events:\n- P1: a(1,0,0) → send to P2 → b(2,0,0)\n- P2: receive from P1 → c(2,1,0) → send to P3 → d(2,2,0)\n- P3: e(0,0,1) → receive from P2 → f(2,2,2)\n\n**Which pairs are causally related?**\n- a → c ✅ (a happened before c via message)\n- a → f ✅ (transitively: a → c → d → f)\n- e ∥ a ❌ (concurrent — neither dominates)\n- e → f ✅ (same process, e before f)\n- b ∥ e ❌ (concurrent)\n\n**Rule:** Compare element-wise. If V1[i] ≤ V2[i] for all i AND V1 ≠ V2, then V1 → V2.\n\n### Problem 2: Detect Conflicting Writes\nTwo replicas R1 and R2 both write to key K:\n- R1 writes K=7 at VC=(3,1)\n- R2 writes K=9 at VC=(2,2)\n\n**Are these conflicting?** Yes! Neither (3,1) ≤ (2,2) nor (2,2) ≤ (3,1). The writes are **concurrent** → conflict detected.\n\n**Resolution options:**\n1. Last-writer-wins (use physical timestamp as tiebreaker)\n2. Application-level merge (CRDTs)\n3. Return both to client (Amazon Dynamo approach)\n\n### Problem 3: Why Not Lamport Clocks?\nSame scenario as Problem 1. Using Lamport clocks:\n- a=1, b=2, c=3, d=4, e=1, f=5\n\nL(e)=1 < L(b)=2, but e ∥ b (concurrent). Lamport clocks say e < b, which is **wrong** — they provide a total order that's consistent with causality but can't detect concurrency. Vector clocks can.\n\n### Problem 4: Consensus Scenario\n3-node Raft cluster. Node A is leader (term 1). Sequence:\n1. Client sends write W1 → A appends, sends to B and C\n2. B acknowledges → A commits W1 (majority: A+B)\n3. Network partition: {A, B} | {C}\n4. C times out, starts election (term 2)\n5. C can't win (only 1 vote — needs 2)\n6. A sends heartbeats to B → cluster continues operating\n7. Partition heals → C receives A's heartbeats, reverts to follower\n\n**Key insight:** The majority partition {A, B} keeps operating. The minority {C} can't elect a leader. W1 is safe because it was committed before the partition.",
      steps: [
        { id: "pr-step-1", kind: "user", content: "Work through vector clock practice problems from week 8", createdAt: stepTs(56) },
        { id: "pr-step-2", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "vector clock practice problems causal ordering consensus scenario", createdAt: stepTs(58) },
        { id: "pr-step-3", kind: "tool-result", content: "Found references to: vector clock exercises, comparing element-wise for concurrency, Lamport vs vector clock distinction, consensus partition scenarios.", createdAt: stepTs(60) },
        { id: "pr-step-4", kind: "text", content: "## 4 Practice Problems Solved\n\n1. Causal ordering with 3 processes — identifying concurrent vs causally related events\n2. Conflicting writes detection using vector clock comparison\n3. Why Lamport clocks can't detect concurrency (vs vector clocks)\n4. Raft consensus during network partition — majority partition keeps operating", createdAt: stepTs(64) },
      ],
      createdAt: stepTs(56),
      completedAt: stepTs(66),
    },
  ];
}

// ===========================================================================
// AGENTS (PM session — Linear MCP + Codex)
// ===========================================================================
function buildPmAgents(baseTs: number): AgentSeed[] {
  const stepTs = (offset: number) => baseTs + offset * 1000;

  return [
    // Agent 1: Create Linear issues for the sprint
    {
      id: "demo-agent-linear-sprint",
      kind: "analysis",
      taskId: PM_TASK_IDS.linearIssues,
      sessionId: PM_SESSION_ID,
      task: "Create Linear issues for the notifications sprint",
      taskContext: "Team agreed on 4 stories: preferences API (5pt, Dev), batching engine (8pt, Dev), preferences UI (5pt, Amir), digest email (5pt, Amir). Two-week sprint starting Monday.",
      status: "completed",
      result: "## Linear Sprint Board — Smart Notifications\n\nI've created all 4 sprint stories in Linear with estimates, assignments, dependencies, and labels.\n\n### Issues Created\n\n| Issue | Points | Assignee | Priority | Status |\n|-------|--------|----------|----------|--------|\n| NOTIF-101: Notification Preferences API | 5 | Dev | High | Ready |\n| NOTIF-102: Notification Batching Engine | 8 | Dev | Urgent | Ready |\n| NOTIF-103: Notification Preferences UI | 5 | Amir | High | Blocked |\n| NOTIF-104: Digest Email Template + SendGrid | 5 | Amir | Medium | Ready |\n\n**Sprint total:** 23 points across 2 engineers (March 16-30)\n\n### Dependencies & Subtasks\n- NOTIF-103 (UI) is **blocked by** Kai's designs — linked as dependency, due Tuesday March 18\n- NOTIF-102 (Batching) **depends on** NOTIF-101 (API) — the batching service reads from the preferences table\n- NOTIF-104 has a subtask: \"SendGrid IP warmup + email authentication setup\" — flagged by the team as a deliverability risk\n\n### Labels Applied\n- `smart-notifications` — feature label for filtering\n- `q1-retention` — ties to the Q1 OKR on engagement recovery\n\n### Sprint Board Setup\n- Sprint dates: March 16-30\n- Dev's critical path: API (days 1-3) → Batching Engine (days 4-10)\n- Amir's critical path: Digest Email (days 1-5) → UI (days 5-10, after designs land)\n- 23 points is tight for 2 engineers — no slack for scope creep",
      steps: [
        { id: "lin-step-1", kind: "user", content: "Create Linear issues for the notifications sprint", createdAt: stepTs(10) },
        { id: "lin-step-2", kind: "thinking", content: "The team agreed on 4 stories with specific point estimates and assignments. Let me pull the exact specs from the conversation — Dev gets the API (5pt) and batching engine (8pt), Amir gets the UI (5pt, blocked on Kai's designs due Tuesday) and digest email (5pt). I also need to capture the dependencies they mentioned: the batching engine reads from the preferences table, and the UI is blocked on designs.", createdAt: stepTs(12) },
        { id: "lin-step-3", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "sprint stories preferences API batching engine sizing assignment", createdAt: stepTs(14) },
        { id: "lin-step-4", kind: "tool-result", content: "Found relevant transcript excerpts:\n- \"I see four main stories. Story one: notification preferences API. Story two: notification batching engine. Story three: preferences UI page. Story four: digest email template and sending.\"\n- \"Preferences API is a 5 — it's well-scoped REST endpoints with tests. Batching engine is an 8 — lots of edge cases with quiet hours, timezone handling, priority scoring.\"\n- \"I'll take the API and the batching engine since they're tightly coupled.\"\n- \"The other engineer — probably Amir — can take the UI and digest email in parallel once Kai's designs land.\"", createdAt: stepTs(16) },
        { id: "lin-step-5", kind: "tool-call", content: "", toolName: "searchMcpTools", toolInput: "linear create issue", createdAt: stepTs(18) },
        { id: "lin-step-6", kind: "tool-result", content: "Available MCP tools:\n- linear:createIssue - Create a new issue in a Linear team\n- linear:updateIssue - Update an existing Linear issue\n- linear:searchIssues - Search for issues in Linear\n- linear:createLabel - Create a new label\n\nLinear MCP integration is available and authenticated.", createdAt: stepTs(20) },
        { id: "lin-step-7", kind: "todo", content: "Sprint issue tracker", todoItems: [
          { id: "lin-todo-1", content: "Create NOTIF-101: Preferences API (5pt, Dev)", status: "in_progress" },
          { id: "lin-todo-2", content: "Create NOTIF-102: Batching Engine (8pt, Dev)", status: "pending" },
          { id: "lin-todo-3", content: "Create NOTIF-103: Preferences UI (5pt, Amir)", status: "pending" },
          { id: "lin-todo-4", content: "Create NOTIF-104: Digest Email (5pt, Amir)", status: "pending" },
        ], createdAt: stepTs(22) },
        { id: "lin-step-8", kind: "tool-call", content: "", toolName: "callMcpTool", toolInput: JSON.stringify({ provider: "linear", tool: "createIssue", input: { title: "Notification Preferences API", description: "REST API with 6-8 endpoints for notification settings. Separate NotificationPreferences table with user_id FK, quiet_hours_start/end, batch_frequency enum, digest_enabled, per_category_overrides JSONB. Zod validation on all inputs. Dev estimates 3-4 days.", estimate: 5, assignee: "Dev", priority: "high", labels: ["smart-notifications", "q1-retention"] } }), createdAt: stepTs(24) },
        { id: "lin-step-9", kind: "tool-result", content: "Issue created: NOTIF-101 — Notification Preferences API\nAssigned to: Dev | Priority: High | Estimate: 5 points\nURL: https://linear.app/team/NOTIF-101", createdAt: stepTs(26) },
        { id: "lin-step-10", kind: "tool-call", content: "", toolName: "callMcpTool", toolInput: JSON.stringify({ provider: "linear", tool: "createIssue", input: { title: "Notification Batching Engine", description: "Cron service on BullMQ running every 15 minutes. Redis sorted set queue with priority scoring (5 signals: sender importance, category weight, recency decay, time sensitivity, engagement history). Groups by user and category. Quiet hours with timezone support via Intl.DateTimeFormat. Urgent notifications (score > 80) bypass batching. Dev estimates 1 week.", estimate: 8, assignee: "Dev", priority: "urgent", labels: ["smart-notifications", "q1-retention"] } }), createdAt: stepTs(28) },
        { id: "lin-step-11", kind: "tool-result", content: "Issue created: NOTIF-102 — Notification Batching Engine\nAssigned to: Dev | Priority: Urgent | Estimate: 8 points\nURL: https://linear.app/team/NOTIF-102", createdAt: stepTs(30) },
        { id: "lin-step-12", kind: "thinking", content: "Two down, two to go. NOTIF-103 (UI) is blocked on Kai's designs landing Tuesday. I should note that dependency in the issue description. NOTIF-104 (digest email) needs a subtask for SendGrid IP warmup — the team flagged email deliverability as a risk.", createdAt: stepTs(32) },
        { id: "lin-step-13", kind: "tool-call", content: "", toolName: "callMcpTool", toolInput: JSON.stringify({ provider: "linear", tool: "createIssue", input: { title: "Notification Preferences UI", description: "Preferences page with: (1) quiet hours time range picker, (2) batch frequency selector (Immediately / Every hour / 3x daily / Once daily), (3) per-category toggles (messages, comments, mentions, task updates, team activity). Progressive disclosure — most users just set quiet hours and frequency. BLOCKED: Kai's designs due Tuesday March 18.", estimate: 5, assignee: "Amir", priority: "high", labels: ["smart-notifications", "q1-retention"] } }), createdAt: stepTs(34) },
        { id: "lin-step-14", kind: "tool-result", content: "Issue created: NOTIF-103 — Notification Preferences UI\nAssigned to: Amir | Priority: High | Estimate: 5 points\nURL: https://linear.app/team/NOTIF-103", createdAt: stepTs(36) },
        { id: "lin-step-15", kind: "tool-call", content: "", toolName: "callMcpTool", toolInput: JSON.stringify({ provider: "linear", tool: "createIssue", input: { title: "Digest Email Template + SendGrid Integration", description: "HTML email digest with: summary header (key stats), category-grouped sections (messages, tasks, team), top 3 items shown by default with '+N more' collapse, deep links for every item (app://notifications/{id} with UTM params). Linear-style clean typography. MJML for cross-client rendering. Subtask: SendGrid IP warmup and email authentication (SPF/DKIM/DMARC).", estimate: 5, assignee: "Amir", priority: "medium", labels: ["smart-notifications", "q1-retention"] } }), createdAt: stepTs(38) },
        { id: "lin-step-16", kind: "tool-result", content: "Issue created: NOTIF-104 — Digest Email Template + SendGrid Integration\nAssigned to: Amir | Priority: Medium | Estimate: 5 points\nURL: https://linear.app/team/NOTIF-104", createdAt: stepTs(40) },
        { id: "lin-step-17", kind: "todo", content: "Sprint issue tracker", todoItems: [
          { id: "lin-todo-1", content: "Create NOTIF-101: Preferences API (5pt, Dev)", status: "completed" },
          { id: "lin-todo-2", content: "Create NOTIF-102: Batching Engine (8pt, Dev)", status: "completed" },
          { id: "lin-todo-3", content: "Create NOTIF-103: Preferences UI (5pt, Amir)", status: "completed" },
          { id: "lin-todo-4", content: "Create NOTIF-104: Digest Email (5pt, Amir)", status: "completed" },
        ], createdAt: stepTs(42) },
        { id: "lin-step-18", kind: "text", content: "## Sprint Board Created\n\nAll 4 stories are live in Linear:\n\n- **NOTIF-101** Preferences API (5pt, Dev, High) — ready to start Monday\n- **NOTIF-102** Batching Engine (8pt, Dev, Urgent) — starts after API\n- **NOTIF-103** Preferences UI (5pt, Amir, High) — blocked on Kai's designs (Tuesday)\n- **NOTIF-104** Digest Email + SendGrid (5pt, Amir, Medium) — includes IP warmup subtask\n\nSprint total: 23 points, March 16-30. Dependencies and labels configured.", createdAt: stepTs(44) },
      ],
      createdAt: stepTs(10),
      completedAt: stepTs(46),
    },

    // Agent 2: Implement notification preferences API via Codex
    {
      id: "demo-agent-codex-api",
      kind: "analysis",
      taskId: PM_TASK_IDS.preferencesApi,
      sessionId: PM_SESSION_ID,
      task: "Implement notification preferences API",
      taskContext: "REST API with 6-8 endpoints for notification settings. Separate NotificationPreferences table with quiet_hours_start, quiet_hours_end, batch_frequency, digest_enabled, digest_time, JSONB per-category overrides. Standard CRUD plus validation.",
      status: "completed",
      result: "## Notification Preferences API — Implemented\n\nCodex generated a production-ready preferences API. All files follow the existing project conventions (Drizzle ORM, Zod validation, Express routing).\n\n### Files Created (5 files, ~620 lines)\n\n**`src/db/models/notification-preferences.ts`** — Drizzle schema\n```ts\nexport const notificationPreferences = pgTable('notification_preferences', {\n  id: uuid('id').primaryKey().defaultRandom(),\n  userId: uuid('user_id').notNull().references(() => users.id),\n  quietHoursStart: time('quiet_hours_start'),  // e.g. \"22:00\"\n  quietHoursEnd: time('quiet_hours_end'),        // e.g. \"08:00\"\n  quietHoursTimezone: varchar('quiet_hours_timezone', { length: 64 }).default('UTC'),\n  batchFrequency: varchar('batch_frequency', { enum: ['immediate','hourly','thrice_daily','daily'] }).default('thrice_daily'),\n  digestEnabled: boolean('digest_enabled').default(true),\n  digestTime: time('digest_time').default('09:00'),\n  perCategoryOverrides: jsonb('per_category_overrides').default('{}'),\n  createdAt: timestamp('created_at').defaultNow(),\n  updatedAt: timestamp('updated_at').defaultNow(),\n});\n```\n\n**`src/api/routes/notification-preferences.ts`** — 6 REST endpoints\n| Method | Path | Description |\n|--------|------|-------------|\n| `GET` | `/api/notifications/preferences` | Get current user's preferences (lazy-creates defaults) |\n| `PUT` | `/api/notifications/preferences` | Partial update (merge semantics) |\n| `GET` | `/api/notifications/preferences/categories` | List categories with per-user overrides |\n| `PUT` | `/api/notifications/preferences/categories/:id` | Update single category settings |\n| `PUT` | `/api/notifications/preferences/quiet-hours` | Set quiet hours with timezone |\n| `POST` | `/api/notifications/preferences/reset` | Reset to platform defaults |\n\n**`src/api/validators/notification-preferences.ts`** — Zod schemas for all inputs\n- `UpdatePreferencesSchema` — partial update with enum validation for batch_frequency\n- `QuietHoursSchema` — validates time format (HH:MM), timezone via `Intl.supportedValuesOf('timeZone')`\n- `CategoryOverrideSchema` — validates channel enum (push/email/in_app) and enabled boolean\n\n**`src/db/migrations/20260316_notification_preferences.ts`** — Migration\n- Creates table with indexes on user_id (unique) and batch_frequency\n- Adds GIN index on per_category_overrides for JSONB queries\n\n**`src/api/__tests__/notification-preferences.test.ts`** — 18 test cases\n- 6 happy-path tests (one per endpoint)\n- 4 validation error tests (bad timezone, invalid batch_frequency, malformed time)\n- 3 edge cases (first-time user lazy creation, concurrent updates, empty JSONB merge)\n- 3 auth tests (unauthenticated, wrong user, missing session)\n- 2 category override tests (merge vs replace semantics)\n\nAll 18 tests passing. No lint errors.",
      steps: [
        { id: "api-step-1", kind: "user", content: "Implement notification preferences API", createdAt: stepTs(50) },
        { id: "api-step-2", kind: "thinking", content: "This is a well-scoped backend task — REST endpoints, database schema, validation. I need to pull the exact schema spec from the conversation first. Dev mentioned: separate NotificationPreferences table with user_id FK, quiet_hours_start/end, batch_frequency (enum), digest_enabled, digest_time, and JSONB for per-category overrides. He estimated 3-4 days but Codex should be able to generate the entire thing.", createdAt: stepTs(52) },
        { id: "api-step-3", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "NotificationPreferences table schema quiet_hours batch_frequency JSONB per-category overrides endpoints", createdAt: stepTs(54) },
        { id: "api-step-4", kind: "tool-result", content: "Found relevant transcript excerpts:\n- \"Separate table. NotificationPreferences with a user_id foreign key. Columns for quiet_hours_start, quiet_hours_end, batch_frequency, digest_enabled, digest_time, and then a JSONB column for per-category overrides.\"\n- \"Standard REST, maybe 6-8 endpoints. I'd estimate 3-4 days for that.\"\n- \"What about the data model? Are we bolting this onto the existing user settings or is it its own thing? — Separate table.\"", createdAt: stepTs(56) },
        { id: "api-step-5", kind: "plan", content: "Preferences API plan", planTitle: "Implement Notification Preferences API", planContent: "1. Extract exact schema from transcript: table structure, column types, constraints\n2. Send to Codex with full spec: Drizzle schema, Express routes, Zod validation, migration\n3. Include edge cases: lazy creation on first GET, JSONB merge semantics for category overrides, timezone validation\n4. Request comprehensive tests: happy path, validation errors, auth, edge cases\n5. Review generated code for correctness", planApprovalState: "approved", createdAt: stepTs(58) },
        { id: "api-step-6", kind: "todo", content: "API implementation checklist", todoItems: [
          { id: "api-todo-1", content: "Extract schema spec from transcript", status: "completed" },
          { id: "api-todo-2", content: "Send to Codex with full spec", status: "in_progress" },
          { id: "api-todo-3", content: "Review generated code", status: "pending" },
          { id: "api-todo-4", content: "Verify all tests pass", status: "pending" },
        ], createdAt: stepTs(60) },
        { id: "api-step-7", kind: "tool-call", content: "", toolName: "codex", toolInput: JSON.stringify({ prompt: "Create a notification preferences REST API following the project's existing patterns (Express router, Drizzle ORM, Zod validation). Schema: NotificationPreferences table with user_id (uuid FK to users, unique), quiet_hours_start (time, nullable), quiet_hours_end (time, nullable), quiet_hours_timezone (varchar 64, default 'UTC'), batch_frequency (enum: immediate/hourly/thrice_daily/daily, default 'thrice_daily'), digest_enabled (boolean, default true), digest_time (time, default '09:00'), per_category_overrides (JSONB, default {}), timestamps. Endpoints: GET /api/notifications/preferences (lazy-create defaults on first access), PUT /api/notifications/preferences (partial update with merge), GET /api/notifications/preferences/categories (list with overrides), PUT /api/notifications/preferences/categories/:id (update single category), PUT /api/notifications/preferences/quiet-hours (set with timezone validation via Intl.supportedValuesOf), POST /api/notifications/preferences/reset (restore defaults). Write Zod validators for all inputs. Write 18+ tests covering happy path, validation errors, auth, and edge cases (lazy creation, concurrent updates, JSONB merge)." }), createdAt: stepTs(62) },
        { id: "api-step-8", kind: "tool-result", content: "Codex task started.\ntaskId: cdx_notif_api_01\nthreadId: thread_notif_api\nstatus: running", createdAt: stepTs(64) },
        { id: "api-step-9", kind: "text", content: "Codex is generating the preferences API — schema, routes, validators, migration, and tests. This covers the full NOTIF-101 story scope.", createdAt: stepTs(66) },
        { id: "api-step-10", kind: "tool-call", content: "", toolName: "codexResult", toolInput: JSON.stringify({ taskId: "cdx_notif_api_01" }), createdAt: stepTs(72) },
        { id: "api-step-11", kind: "tool-result", content: "Codex task completed.\nstatus: completed\n\nFiles created:\n- src/db/models/notification-preferences.ts (Drizzle schema with indexes)\n- src/db/migrations/20260316_notification_preferences.ts (table + GIN index)\n- src/api/routes/notification-preferences.ts (6 REST endpoints, 180 lines)\n- src/api/validators/notification-preferences.ts (3 Zod schemas)\n- src/api/__tests__/notification-preferences.test.ts (18 tests)\n\nTest results: 18/18 passing\nLint: 0 errors, 0 warnings\n\nKey implementation notes:\n- GET /preferences lazy-creates default row on first access\n- PUT /preferences uses JSONB merge (not replace) for per_category_overrides\n- Timezone validation uses Intl.supportedValuesOf('timeZone')\n- Unique constraint on user_id prevents duplicate preference rows", createdAt: stepTs(76) },
        { id: "api-step-12", kind: "thinking", content: "Codex generated all 5 files with 18 passing tests. Let me verify the key implementation details match what the team discussed: lazy creation on first GET, JSONB merge semantics for category overrides, timezone validation. The Intl.supportedValuesOf approach is clean — no external dependency needed. The GIN index on per_category_overrides is a nice touch for future JSONB queries.", createdAt: stepTs(78) },
        { id: "api-step-13", kind: "todo", content: "API implementation checklist", todoItems: [
          { id: "api-todo-1", content: "Extract schema spec from transcript", status: "completed" },
          { id: "api-todo-2", content: "Send to Codex with full spec", status: "completed" },
          { id: "api-todo-3", content: "Review generated code", status: "completed" },
          { id: "api-todo-4", content: "Verify all tests pass", status: "completed" },
        ], createdAt: stepTs(80) },
        { id: "api-step-14", kind: "text", content: "## Notification Preferences API — Complete\n\nCodex generated 5 files (~620 lines) implementing the full NOTIF-101 story:\n\n- **Drizzle schema** with user_id unique constraint and GIN index on JSONB\n- **6 REST endpoints** with lazy creation, merge semantics, and timezone validation\n- **3 Zod validators** covering all input shapes\n- **18 tests passing** — happy path, validation, auth, edge cases\n\nReady for code review. Dev can focus on the batching engine (NOTIF-102) instead of spending 3-4 days on this.", createdAt: stepTs(82) },
      ],
      createdAt: stepTs(50),
      completedAt: stepTs(84),
    },

    // Agent 3: Build notification batching service via Codex
    {
      id: "demo-agent-codex-batcher",
      kind: "analysis",
      taskId: PM_TASK_IDS.batchingEngine,
      sessionId: PM_SESSION_ID,
      task: "Build notification batching service",
      taskContext: "Cron service on BullMQ running every 15 minutes. Redis sorted set queue with priority scoring. Groups by user and category. Handles quiet hours with timezone support. Five priority signals: sender importance, category weight, recency decay, time sensitivity, engagement history.",
      status: "completed",
      result: "## Notification Batching Service — Implemented\n\nCodex generated the complete batching pipeline across 6 files (~890 lines). This is the most complex piece of the sprint — the 8-point story that Dev estimated would take a full week.\n\n### Architecture\n```\n                           ┌─────────────────┐\n  Notification arrives ──▶ │  Redis Sorted    │\n  (from app event bus)     │  Set Queue       │\n                           │  score = priority│\n                           └────────┬────────┘\n                                    │\n                           ┌────────▼────────┐\n                           │  BullMQ Cron     │\n                           │  (every 15 min)  │\n                           └────────┬────────┘\n                                    │\n                    ┌───────────────┼───────────────┐\n                    ▼               ▼               ▼\n             ┌──────────┐   ┌──────────┐   ┌──────────┐\n             │ Group by  │   │ Check    │   │ Score    │\n             │ user +    │   │ quiet    │   │ > 80?    │\n             │ category  │   │ hours    │   │ URGENT   │\n             └─────┬────┘   └─────┬────┘   └─────┬────┘\n                   │              │              │\n                   ▼              ▼              ▼\n             Batch Window    Hold for       Deliver\n             (2-3 digests)   next window    Immediately\n```\n\n### Files Created\n\n**`src/services/notification-batcher.ts`** — Core orchestrator (210 lines)\n- BullMQ repeatable job registered at startup: `every: '15 minutes'`\n- On each tick: pull pending notifications from Redis, group by user_id + category\n- For each group: check quiet hours → score notifications → deliver or hold\n- Graceful degradation: if Redis is unreachable, falls back to immediate delivery with a warning log\n\n**`src/services/priority-scorer.ts`** — 5-signal scoring engine (150 lines)\n| Signal | Weight | Source | Calculation |\n|--------|--------|--------|-------------|\n| Sender importance | 0-25 | User interaction frequency table | `log2(interactions + 1) / log2(maxInteractions + 1) * 25` |\n| Category weight | 0-20 | User's per-category preferences | Direct from preferences JSONB |\n| Recency decay | 0-20 | Notification created_at | `20 * exp(-age_hours / 12)` — half-life of ~8 hours |\n| Time sensitivity | 0-20 | User's active hours pattern | Higher during historically active hours |\n| Engagement history | 0-15 | Click-through rate on similar types | `min(ctr * 100, 15)` |\n\nUrgent threshold: **score > 80** bypasses batching entirely.\n\n**`src/services/notification-queue.ts`** — Redis sorted set adapter (80 lines)\n- `enqueue(notification)`: `ZADD notifications:{userId} {score} {payload}`\n- `dequeueForUser(userId, count)`: `ZPOPMAX notifications:{userId} {count}`\n- `pendingCount(userId)`: `ZCARD notifications:{userId}`\n\n**`src/services/quiet-hours.ts`** — Timezone-aware checker (70 lines)\n- Uses `Intl.DateTimeFormat` with user's timezone to get local hour\n- Handles overnight ranges (e.g., 22:00 → 08:00 crossing midnight)\n- Returns `{ isQuiet: boolean; resumesAt: Date }` so batching knows when to retry\n\n**`src/services/__tests__/notification-batcher.test.ts`** — 24 tests\n- Grouping: groups by user, groups by category, handles mixed\n- Quiet hours: respects quiet hours, handles midnight crossing, handles missing timezone\n- Batching: delivers urgent (>80) immediately, holds low-priority for batch window\n- Fallback: continues working when Redis is down\n- Edge cases: empty queue, single notification, max batch size\n\n**`src/services/__tests__/priority-scorer.test.ts`** — 12 tests\n- Each signal tested independently with known inputs\n- Combined scoring with boundary cases (all max, all min, mixed)\n- Urgency threshold: verifies score > 80 triggers immediate delivery\n\n### All 36 tests passing. No lint errors.",
      steps: [
        { id: "batch-step-1", kind: "user", content: "Build notification batching service", createdAt: stepTs(88) },
        { id: "batch-step-2", kind: "thinking", content: "This is the 8-point story — the most complex piece of the sprint. Dev estimated a full week. Let me break down what we need from the conversation: BullMQ cron every 15 minutes, Redis sorted set queue, 5-signal priority scoring, quiet hours with timezone support, and urgent bypass for score > 80. I should also grab the exact scoring signals Dev described.", createdAt: stepTs(90) },
        { id: "batch-step-3", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "priority scoring five signals sender importance category weight recency decay time sensitivity engagement", createdAt: stepTs(92) },
        { id: "batch-step-4", kind: "tool-result", content: "Found relevant transcript excerpts:\n- \"I'm thinking five signals: sender importance based on the user's interaction history, notification category weight which we can configure per-user, recency decay so older notifications score lower, time-of-day sensitivity, and engagement history — has the user tapped similar notifications before.\"\n- \"we can use last_active_at from the sessions table. If they're active, immediate delivery. If they're away, batch it.\"\n- \"Redis sorted sets would work perfectly here. Score is the priority, we just ZRANGEBYSCORE to pull the top items.\"", createdAt: stepTs(94) },
        { id: "batch-step-5", kind: "plan", content: "Batching service plan", planTitle: "Build Notification Batching Service", planContent: "1. Core orchestrator: BullMQ repeatable job (every 15 min), pull from Redis, group by user+category\n2. Priority scorer: 5 signals with configurable weights, score 0-100, urgent threshold > 80\n3. Redis queue adapter: sorted set per user, ZADD/ZPOPMAX operations\n4. Quiet hours checker: Intl.DateTimeFormat for timezone, handle midnight crossing\n5. Comprehensive tests: 24 for batcher + 12 for scorer\n6. Graceful degradation: fallback to immediate delivery if Redis is down", planApprovalState: "approved", createdAt: stepTs(96) },
        { id: "batch-step-6", kind: "todo", content: "Batching service checklist", todoItems: [
          { id: "batch-todo-1", content: "Gather exact requirements from transcript", status: "completed" },
          { id: "batch-todo-2", content: "Send architecture spec to Codex", status: "in_progress" },
          { id: "batch-todo-3", content: "Review generated code for correctness", status: "pending" },
          { id: "batch-todo-4", content: "Verify all 36 tests pass", status: "pending" },
        ], createdAt: stepTs(98) },
        { id: "batch-step-7", kind: "tool-call", content: "", toolName: "codex", toolInput: JSON.stringify({ prompt: "Build a notification batching service with the following architecture:\n\n1. notification-batcher.ts: BullMQ repeatable job every 15 minutes. On tick: pull pending notifications from Redis sorted set, group by user_id + category, check quiet hours, score, deliver or hold. Graceful degradation if Redis is down (fall back to immediate delivery).\n\n2. priority-scorer.ts: 5-signal scoring engine (0-100). Signals: sender importance (0-25, based on interaction frequency, use log2 scaling), category weight (0-20, from user preferences JSONB), recency decay (0-20, exponential decay with 8-hour half-life), time sensitivity (0-20, based on user's active hours), engagement history (0-15, CTR on similar notification types). Urgent threshold: score > 80 bypasses batching.\n\n3. notification-queue.ts: Redis sorted set adapter. ZADD for enqueue (score = priority), ZPOPMAX for dequeue, ZCARD for count. Key pattern: notifications:{userId}.\n\n4. quiet-hours.ts: Timezone-aware using Intl.DateTimeFormat. Handle overnight ranges crossing midnight. Return { isQuiet, resumesAt }.\n\n5. Tests: 24 for batcher (grouping, quiet hours, batching logic, fallback, edge cases) + 12 for scorer (individual signals, combined scoring, urgency threshold).\n\nUse the project's existing patterns (TypeScript, Vitest, ioredis)." }), createdAt: stepTs(100) },
        { id: "batch-step-8", kind: "tool-result", content: "Codex task started.\ntaskId: cdx_batcher_01\nthreadId: thread_batcher\nstatus: running", createdAt: stepTs(102) },
        { id: "batch-step-9", kind: "text", content: "Codex is building the batching service — this is the largest piece of the sprint. Generating 4 source files + 2 test files with the priority scoring engine, Redis queue adapter, quiet hours checker, and BullMQ orchestrator.", createdAt: stepTs(104) },
        { id: "batch-step-10", kind: "tool-call", content: "", toolName: "codexResult", toolInput: JSON.stringify({ taskId: "cdx_batcher_01" }), createdAt: stepTs(112) },
        { id: "batch-step-11", kind: "tool-result", content: "Codex task completed.\nstatus: completed\n\nFiles created:\n- src/services/notification-batcher.ts (BullMQ cron + grouping + delivery logic, 210 lines)\n- src/services/priority-scorer.ts (5-signal scoring engine, 150 lines)\n- src/services/notification-queue.ts (Redis sorted set adapter, 80 lines)\n- src/services/quiet-hours.ts (timezone-aware quiet hours checker, 70 lines)\n- src/services/__tests__/notification-batcher.test.ts (24 tests)\n- src/services/__tests__/priority-scorer.test.ts (12 tests)\n\nTest results: 36/36 passing\nLint: 0 errors, 0 warnings\n\nImplementation notes:\n- Priority scorer uses log2 scaling for sender importance to avoid linear skew\n- Recency decay uses exp(-age_hours / 12) giving ~8-hour half-life\n- Quiet hours handles overnight ranges (22:00 → 08:00) correctly\n- Redis fallback logs warning but doesn't crash — degrades to immediate delivery", createdAt: stepTs(116) },
        { id: "batch-step-12", kind: "thinking", content: "All 36 tests passing. Let me verify the key implementation details: the log2 scaling for sender importance is smart — prevents power users from dominating the score. The 8-hour half-life on recency decay means a notification loses ~63% of its recency score after 8 hours, which seems reasonable. The Redis fallback behavior is exactly what Dev suggested — degrade gracefully, don't crash.", createdAt: stepTs(118) },
        { id: "batch-step-13", kind: "todo", content: "Batching service checklist", todoItems: [
          { id: "batch-todo-1", content: "Gather exact requirements from transcript", status: "completed" },
          { id: "batch-todo-2", content: "Send architecture spec to Codex", status: "completed" },
          { id: "batch-todo-3", content: "Review generated code for correctness", status: "completed" },
          { id: "batch-todo-4", content: "Verify all 36 tests pass", status: "completed" },
        ], createdAt: stepTs(120) },
        { id: "batch-step-14", kind: "text", content: "## Notification Batching Service — Complete\n\nCodex generated 6 files (~890 lines) implementing the full NOTIF-102 story:\n\n- **BullMQ orchestrator** — 15-minute cron, group-by-user-and-category, deliver-or-hold logic\n- **5-signal priority scorer** — log2-scaled sender importance, exponential recency decay (8h half-life), engagement CTR\n- **Redis sorted set queue** — ZADD/ZPOPMAX per user, graceful fallback if Redis is down\n- **Quiet hours checker** — Intl.DateTimeFormat timezone resolution, handles midnight crossing\n- **36 tests all passing** — grouping, quiet hours, scoring, urgency bypass, edge cases\n\nThis was the 8-point story Dev estimated at 1 week. Ready for code review.", createdAt: stepTs(122) },
      ],
      createdAt: stepTs(88),
      completedAt: stepTs(124),
    },

    // Agent 4: Design digest email template
    {
      id: "demo-agent-digest-design",
      kind: "analysis",
      taskId: PM_TASK_IDS.digestDesign,
      sessionId: PM_SESSION_ID,
      task: "Design digest email template",
      taskContext: "HTML email template for daily notification digest. Should look like Linear's emails — clean typography, good hierarchy, renders well on mobile. Summary header with stats, category-grouped sections, collapsible items, deep links for re-engagement. Track which items get tapped.",
      status: "completed",
      result: "## Digest Email Template — Complete Spec\n\nDesigned a production-ready email template following Kai's direction: Linear-style clean typography, minimal HTML, fast mobile rendering. Based on best practices from Notion, Linear, and GitHub digest emails.\n\n### Template Structure\n```\n┌──────────────────────────────────────────┐\n│  Your Daily Digest                       │\n│  Wednesday, March 16                     │\n│                                          │\n│  12 new · 3 mentions · 2 completed       │\n├──────────────────────────────────────────┤\n│                                          │\n│  Messages (5 new)                        │\n│  ├ Sarah commented on NOTIF-101          │\n│  ├ Dev mentioned you in #backend         │\n│  ├ Amir replied to your PR review        │\n│  └ +2 more →                             │\n│                                          │\n│  Task Updates (4)                        │\n│  ├ NOTIF-102 moved to In Progress        │\n│  ├ Code review requested: PR #847        │\n│  └ +2 more →                             │\n│                                          │\n│  Team Activity (3)                       │\n│  ├ Sprint velocity: 18/23 pts done       │\n│  └ Kai shared design specs in #design    │\n│                                          │\n├──────────────────────────────────────────┤\n│  Manage preferences · Unsubscribe        │\n└──────────────────────────────────────────┘\n```\n\n### Design System\n- **Framework:** MJML compiled to responsive HTML — 85% email client compatibility (Gmail, Outlook, Apple Mail, Yahoo)\n- **Typography:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif` — 16px body, 24px headers, 13px meta\n- **Colors:** `#1a1a1a` text, `#f8f8f8` background, `#2563eb` links, `#e5e7eb` borders\n- **Layout:** single column, 600px max-width, 16px horizontal padding, scales to 320px mobile\n- **Spacing:** 24px between sections, 12px between items, 8px icon-to-text gap\n\n### Deep Linking Strategy\nEvery item is tappable with attribution tracking:\n```\nhttps://app.example.com/notifications/{id}\n  ?utm_source=digest\n  &utm_medium=email\n  &utm_campaign=daily_digest\n  &utm_content={category}_{position}\n```\n- Position tracking reveals which items in the digest get the most engagement\n- Category tracking feeds back into the priority scoring model\n- Open tracking via 1x1 transparent pixel at bottom of email\n\n### Subject Line Strategy\n- **Format:** `{count} updates you missed` — personalized count drives 26% higher open rates\n- **Preheader:** first 3 notification summaries, truncated to 90 chars\n- **Send time:** user's configured `digest_time` from preferences API (default 9:00 AM local)\n- **From:** `Notifications <notifications@example.com>` — consistent, recognizable sender\n\n### Re-engagement Metrics\n| Metric | Target | Measurement |\n|--------|--------|-------------|\n| Open rate | 35%+ | 1x1 pixel |\n| Click-through rate | 15%+ | UTM tracking per item |\n| Re-engagement | 20%+ | App session within 30 min of open |\n| Unsubscribe rate | < 0.5% | Alert if threshold exceeded |\n\n### Compliance\n- CAN-SPAM: physical address in footer, one-click unsubscribe, honest subject line\n- GDPR: unsubscribe link, no tracking without consent, data retention policy link\n- Apple MPP: don't rely solely on open rates — use click-through as primary signal\n\n### SendGrid Integration Notes\n- Use dynamic templates with Handlebars for category sections\n- IP warmup plan: start with 100 emails/day, ramp 2x weekly over 4 weeks\n- SPF, DKIM, DMARC authentication required before first send\n- Set up click tracking domain (`email.example.com`) for branded links",
      steps: [
        { id: "dig-step-1", kind: "user", content: "Design digest email template", createdAt: stepTs(128) },
        { id: "dig-step-2", kind: "thinking", content: "Kai described a very specific vision: Linear-style clean emails with summary header, category-grouped sections, collapsible items, and deep links for re-engagement tracking. I need to research best practices for digest email design and then combine that with the exact requirements from the discussion. Let me also look at what Notion and GitHub do — they were mentioned as reference points.", createdAt: stepTs(130) },
        { id: "dig-step-3", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "email digest design best practices 2026 MJML responsive template re-engagement metrics", createdAt: stepTs(132) },
        { id: "dig-step-4", kind: "tool-result", content: "Key findings:\n- MJML is the industry standard for responsive email templates — compiles to HTML compatible with 85%+ email clients\n- Single column layout performs best on mobile (72% of email opens are on mobile)\n- Personalized subject lines with dynamic counts increase open rates by 26% vs generic subjects\n- Deep links with UTM params enable per-item click attribution\n- CAN-SPAM requires physical address and one-click unsubscribe; GDPR adds consent requirements\n- Notion achieves 38% open rate with minimal HTML design — key is clean typography and scannable layout\n- Apple Mail Privacy Protection (MPP) makes open tracking unreliable — use click-through as primary signal", createdAt: stepTs(134) },
        { id: "dig-step-5", kind: "tool-call", content: "", toolName: "searchWeb", toolInput: "Linear email design system typography colors notification digest template examples", createdAt: stepTs(136) },
        { id: "dig-step-6", kind: "tool-result", content: "Linear email design characteristics:\n- System font stack: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif\n- Muted color palette: dark text on light background, blue links (#2563eb), subtle gray borders\n- Minimal decoration: no images, no heavy styling, pure typography hierarchy\n- Single CTA per section, clear visual separation between content groups\n- GitHub digest emails: similar approach, 3-5 sections max, position-based click tracking", createdAt: stepTs(138) },
        { id: "dig-step-7", kind: "tool-call", content: "", toolName: "searchTranscriptHistory", toolInput: "digest email design template linear clean typography deep links tracking categories", createdAt: stepTs(140) },
        { id: "dig-step-8", kind: "tool-result", content: "Found relevant transcript excerpts:\n- \"HTML but minimal. Think Linear's emails — clean typography, good hierarchy, renders great on mobile. Nothing fancy with images or heavy styling.\"\n- \"Summary header with key stats, then sections grouped by category — 'You had 12 new comments, 3 mentions, and 2 task completions.' Each section is collapsible with the top 3 most important items shown by default.\"\n- \"Every item in the digest should be tappable and deep-link to the exact notification in the app. That's the re-engagement mechanism.\"\n- \"Track which items in the digest get tapped. That feeds back into the priority scoring model.\"\n- \"email deliverability. If we're sending digests to everyone we need to make sure our SendGrid sender reputation stays clean.\"", createdAt: stepTs(142) },
        { id: "dig-step-9", kind: "thinking", content: "Now I have the full picture. The team wants: Linear-style typography (system fonts, muted colors), category-grouped sections (messages, tasks, team activity), top 3 items per section with '+N more' links, deep links with UTM tracking that feeds back into priority scoring, and SendGrid IP warmup for deliverability. Let me also add Apple MPP guidance since it affects open rate tracking — they should use click-through as the primary signal, not open rate.", createdAt: stepTs(144) },
        { id: "dig-step-10", kind: "todo", content: "Digest email checklist", todoItems: [
          { id: "dig-todo-1", content: "Research email design best practices (MJML, responsive)", status: "completed" },
          { id: "dig-todo-2", content: "Analyze Linear/Notion email design patterns", status: "completed" },
          { id: "dig-todo-3", content: "Extract exact requirements from transcript", status: "completed" },
          { id: "dig-todo-4", content: "Define template structure and design system", status: "completed" },
          { id: "dig-todo-5", content: "Specify deep linking and tracking strategy", status: "completed" },
          { id: "dig-todo-6", content: "Add compliance and deliverability notes", status: "completed" },
        ], createdAt: stepTs(146) },
        { id: "dig-step-11", kind: "text", content: "## Digest Email Template — Complete\n\nFull spec covering:\n- **Template structure:** summary header → 3 category sections (messages, tasks, team) → top 3 items + overflow → footer\n- **Design system:** system fonts, muted palette, 600px single column, MJML for 85% client compatibility\n- **Deep linking:** every item links to `app://notifications/{id}` with UTM params for position + category tracking\n- **Re-engagement metrics:** open rate (35%+), CTR (15%+), app session within 30 min (20%+)\n- **Compliance:** CAN-SPAM, GDPR, Apple MPP guidance\n- **SendGrid:** IP warmup plan, SPF/DKIM/DMARC authentication, branded click tracking domain\n\nReady for Kai to implement in MJML. Click tracking feeds directly into the priority scoring model from NOTIF-102.", createdAt: stepTs(148) },
      ],
      createdAt: stepTs(128),
      completedAt: stepTs(150),
    },
  ];
}

// ===========================================================================
// FINAL SUMMARY (PM session)
// ===========================================================================
function buildPmFinalSummary(baseTs: number) {
  return {
    narrative: "The team designed a Smart Notifications system to combat notification fatigue driving a 15% engagement drop and 3x support ticket increase. The solution has three pillars: intelligent batching (grouping 47 daily notifications into 2-3 digest windows), priority scoring (5-signal weighted model: sender importance, category weight, recency decay, time sensitivity, engagement history), and digest emails for re-engagement. A two-week sprint was planned with 4 stories totaling 23 points across 2 engineers. Dev takes the preferences API (3-4 days) and batching engine (1 week), Amir handles the UI and digest email. Phase one uses a rules-based scoring engine; ML model deferred to Q3.",
    agreements: [
      "Build intelligent notification batching — group into 2-3 daily windows unless truly urgent (score > 80)",
      "Priority scoring with 5 signals: sender importance, category weight, recency decay, time sensitivity, engagement history",
      "Quiet hours with timezone support — default 10 PM to 8 AM",
      "Daily digest emails as re-engagement mechanism — Linear-style clean design with deep links",
      "Two-week sprint: 23 points across Dev (API + batching) and Amir (UI + digest)",
      "Phase one: rules engine. Phase two (Q3): proper ML model trained on interaction data",
    ],
    missedItems: [
      "No A/B testing plan for the rollout — mentioned but explicitly deferred as follow-up",
      "Email deliverability and SendGrid IP warmup not scoped in detail — flagged as subtask only",
      "Priority scoring data sources need validation — where does 'sender importance' data actually come from?",
    ],
    unansweredQuestions: [
      "What happens to notifications during quiet hours — queued until morning or dropped entirely?",
      "How does the system handle notification permissions on iOS vs Android?",
      "What's the fallback if the batching service goes down — immediate delivery or silent failure?",
    ],
    agreementTodos: [
      { text: "Create Linear issues for all 4 sprint stories with sizing and assignments", doer: "agent" as const },
      { text: "Implement notification preferences API with Drizzle schema and Zod validation", doer: "agent" as const },
      { text: "Build notification batching service with BullMQ cron and priority scoring", doer: "agent" as const },
      { text: "Design digest email template following Linear-style guidelines", doer: "agent" as const },
    ],
    missedItemTodos: [
      { text: "Design A/B testing plan for smart notifications rollout — 10% cohort, 1-week measurement", doer: "human" as const },
      { text: "Research SendGrid IP warmup requirements and timeline for digest email volume", doer: "agent" as const },
    ],
    unansweredQuestionTodos: [
      { text: "Define quiet hours notification handling policy — queue vs drop vs summary", doer: "human" as const },
      { text: "Document platform-specific notification permission flows for iOS and Android", doer: "agent" as const },
    ],
    actionItems: [
      { text: "Kai: deliver preferences UI designs by Tuesday", doer: "human" as const },
      { text: "Dev: start preferences API implementation Monday", doer: "human" as const },
      { text: "Lena: set up engagement metrics dashboard to measure notification fatigue improvement", doer: "human" as const },
    ],
    generatedAt: baseTs + 90_000,
  };
}

// ===========================================================================
// AGENTS FLEET SUMMARY (PM session)
// ===========================================================================
function buildPmAgentsSummary(baseTs: number) {
  return {
    overallNarrative: "Four agents executed the smart notifications sprint kickoff. The Linear agent created all 4 sprint stories with sizing, assignments, and dependencies. Two Codex agents generated production-ready code — the preferences API (6 endpoints, 18 tests) and the batching service (priority scoring, quiet hours, 36 tests). The design agent produced a comprehensive digest email template spec based on industry best practices. This is the first session where agents both managed project tooling (Linear) and generated code (Codex), demonstrating the full PM-to-code pipeline.",
    agentHighlights: [
      {
        agentId: "demo-agent-linear-sprint",
        task: "Create Linear issues for sprint",
        status: "completed" as const,
        keyFinding: "4 issues created in Linear with estimates, assignments, labels, and dependencies. Sprint total: 23 points across Dev and Amir for a 2-week sprint.",
      },
      {
        agentId: "demo-agent-codex-api",
        task: "Implement notification preferences API",
        status: "completed" as const,
        keyFinding: "Codex generated 5 files: Express router with 6 endpoints, Drizzle schema, migration, Zod validators, and 18 passing tests. Full REST API for notification settings.",
      },
      {
        agentId: "demo-agent-codex-batcher",
        task: "Build notification batching service",
        status: "completed" as const,
        keyFinding: "Codex built the complete batching pipeline: BullMQ cron, Redis sorted set queue, 5-signal priority scorer, timezone-aware quiet hours. 36 tests all passing.",
      },
      {
        agentId: "demo-agent-digest-design",
        task: "Design digest email template",
        status: "completed" as const,
        keyFinding: "MJML-based responsive template with Linear-style typography, category-grouped sections, deep links for re-engagement tracking. CAN-SPAM compliant.",
      },
    ],
    coverageGaps: [
      "Priority scoring ML model (phase 2) wasn't prototyped — the rules engine is a placeholder",
      "Mobile push notification specifics (iOS APNs vs Android FCM) weren't addressed",
      "No load testing or performance benchmarks for the batching service at scale",
    ],
    nextSteps: [
      "Review and merge Codex-generated code — start with the preferences API PR",
      "Kai: finalize designs by Tuesday so Amir can start the preferences UI",
      "Set up engagement metrics dashboard to track notification fatigue improvement post-launch",
      "Plan A/B testing cohort for smart notifications rollout (10% of users, 1-week measurement)",
    ],
    generatedAt: baseTs + 95_000,
    totalAgents: 4,
    succeededAgents: 4,
    failedAgents: 0,
    totalDurationSecs: 280,
  };
}

// ===========================================================================
// Main seed function
// ===========================================================================
export function seedDemoData(db: Database.Database): void {
  const BASE_TS = Date.now();
  const TRIP_START = BASE_TS - 45 * 60_000;
  const BRAIN_START = BASE_TS - 40 * 60_000;
  const STUDY_START = BASE_TS - 35 * 60_000;
  const MEETING_START = BASE_TS - 30 * 60_000;
  const PM_START = BASE_TS - 25 * 60_000;

  const insertAll = db.transaction(() => {
    // Create sessions
    insertSession(db, TRIP_SESSION_ID, "Japan Trip Planning", TRIP_START, TRIP_START, 0, "en", "ja");
    insertSession(db, BRAIN_SESSION_ID, "AI Recipe App Brainstorm", BRAIN_START, BRAIN_START, 0, "en", "");
    insertSession(db, STUDY_SESSION_ID, "Distributed Systems Exam Prep", STUDY_START, STUDY_START, 0, "en", "");
    insertSession(db, MEETING_SESSION_ID, "Sprint Review & Planning", MEETING_START, MEETING_START, 0, "en", "");
    insertSession(db, PM_SESSION_ID, "Smart Notifications Sprint", PM_START, PM_START, 0, "en", "");

    // Insert blocks, insights, tasks
    const tripEnd = insertBlocks(db, TRIP_SESSION_ID, TRIP_BLOCKS, TRIP_START, [5000, 10000], "English", "Japanese");
    insertInsights(db, TRIP_SESSION_ID, TRIP_INSIGHTS, TRIP_START + 3 * 60_000, 90_000);
    const tripTaskStart = TRIP_START + 5 * 60_000;
    insertTasks(db, TRIP_SESSION_ID, TRIP_TASKS, tripTaskStart, 120_000);
    updateSession(db, TRIP_SESSION_ID, tripEnd, TRIP_BLOCKS.length);

    const brainEnd = insertBlocks(db, BRAIN_SESSION_ID, BRAIN_BLOCKS, BRAIN_START, [8000, 15000], "English", "");
    insertInsights(db, BRAIN_SESSION_ID, BRAIN_INSIGHTS, BRAIN_START + 4 * 60_000, 120_000);
    insertTasks(db, BRAIN_SESSION_ID, BRAIN_TASKS, BRAIN_START + 6 * 60_000, 150_000);
    updateSession(db, BRAIN_SESSION_ID, brainEnd, BRAIN_BLOCKS.length);

    const studyEnd = insertBlocks(db, STUDY_SESSION_ID, STUDY_BLOCKS, STUDY_START, [6000, 12000], "English", "");
    insertInsights(db, STUDY_SESSION_ID, STUDY_INSIGHTS, STUDY_START + 3 * 60_000, 100_000);
    insertTasks(db, STUDY_SESSION_ID, STUDY_TASKS, STUDY_START + 5 * 60_000, 120_000);
    updateSession(db, STUDY_SESSION_ID, studyEnd, STUDY_BLOCKS.length);

    const meetingEnd = insertBlocks(db, MEETING_SESSION_ID, MEETING_BLOCKS, MEETING_START, [5000, 10000], "English", "");
    insertInsights(db, MEETING_SESSION_ID, MEETING_INSIGHTS, MEETING_START + 2 * 60_000, 80_000);
    const meetingTaskStart = MEETING_START + 4 * 60_000;
    insertTasks(db, MEETING_SESSION_ID, MEETING_TASKS, meetingTaskStart, 100_000);
    updateSession(db, MEETING_SESSION_ID, meetingEnd, MEETING_BLOCKS.length);

    const pmEnd = insertBlocks(db, PM_SESSION_ID, PM_BLOCKS, PM_START, [5000, 10000], "English", "");
    insertInsights(db, PM_SESSION_ID, PM_INSIGHTS, PM_START + 3 * 60_000, 90_000);
    insertTasks(db, PM_SESSION_ID, PM_TASKS, PM_START + 4 * 60_000, 100_000);
    updateSession(db, PM_SESSION_ID, pmEnd, PM_BLOCKS.length);

    // Insert agents
    const demoAgents = [
      ...buildAgents(MEETING_START),
      ...buildBrainAgents(BRAIN_START),
      ...buildStudyAgents(STUDY_START),
      ...buildPmAgents(PM_START),
    ];
    for (const agent of demoAgents) {
      insertAgent(db, agent);
    }

    // Insert final summaries
    const meetingSummary = buildMeetingFinalSummary(MEETING_START);
    updateSessionSummary(
      db,
      MEETING_SESSION_ID,
      JSON.stringify(meetingSummary),
      meetingSummary.narrative,
      JSON.stringify(meetingSummary.actionItems),
      meetingSummary.generatedAt,
    );

    const tripSummary = buildTripFinalSummary(TRIP_START);
    updateSessionSummary(
      db,
      TRIP_SESSION_ID,
      JSON.stringify(tripSummary),
      tripSummary.narrative,
      JSON.stringify(tripSummary.actionItems),
      tripSummary.generatedAt,
    );

    // Insert BRAIN summary + agents
    const brainSummary = buildBrainFinalSummary(BRAIN_START);
    updateSessionSummary(
      db,
      BRAIN_SESSION_ID,
      JSON.stringify(brainSummary),
      brainSummary.narrative,
      JSON.stringify(brainSummary.actionItems),
      brainSummary.generatedAt,
    );

    // Insert STUDY summary + agents
    const studySummary = buildStudyFinalSummary(STUDY_START);
    updateSessionSummary(
      db,
      STUDY_SESSION_ID,
      JSON.stringify(studySummary),
      studySummary.narrative,
      JSON.stringify(studySummary.actionItems),
      studySummary.generatedAt,
    );

    // Insert PM summary
    const pmSummary = buildPmFinalSummary(PM_START);
    updateSessionSummary(
      db,
      PM_SESSION_ID,
      JSON.stringify(pmSummary),
      pmSummary.narrative,
      JSON.stringify(pmSummary.actionItems),
      pmSummary.generatedAt,
    );

    // Insert agents fleet summaries
    const meetingAgentsSummary = buildMeetingAgentsSummary(MEETING_START);
    updateSessionAgentsSummary(db, MEETING_SESSION_ID, JSON.stringify(meetingAgentsSummary), meetingAgentsSummary.generatedAt);

    const tripAgentsSummary = buildTripAgentsSummary(TRIP_START);
    updateSessionAgentsSummary(db, TRIP_SESSION_ID, JSON.stringify(tripAgentsSummary), tripAgentsSummary.generatedAt);

    const brainAgentsSummary = buildBrainAgentsSummary(BRAIN_START);
    updateSessionAgentsSummary(db, BRAIN_SESSION_ID, JSON.stringify(brainAgentsSummary), brainAgentsSummary.generatedAt);

    const studyAgentsSummary = buildStudyAgentsSummary(STUDY_START);
    updateSessionAgentsSummary(db, STUDY_SESSION_ID, JSON.stringify(studyAgentsSummary), studyAgentsSummary.generatedAt);

    const pmAgentsSummary = buildPmAgentsSummary(PM_START);
    updateSessionAgentsSummary(db, PM_SESSION_ID, JSON.stringify(pmAgentsSummary), pmAgentsSummary.generatedAt);
  });

  insertAll();
}
