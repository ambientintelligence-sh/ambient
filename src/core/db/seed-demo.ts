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
  { id: TRIP_TASK_IDS.flights, text: "Book round-trip flights SFO -> NRT for April 5-15", details: "Compare ANA ($870), JAL ($890), Zipair ($640), United ($780). Group prefers ANA or JAL for comfort but open to budget if savings are significant. Need to book before prices increase.", size: "large", source: "ai" },
  { id: TRIP_TASK_IDS.ryokan, text: "Reserve ryokan in Hakone for 2 nights", details: "Budget under $250/night. Must have private onsen. Look at Hakone Ginyu, Yama no Chaya, Senkyoro. Book early for April availability.", size: "large", source: "ai" },
  { id: TRIP_TASK_IDS.itinerary, text: "Create shared Google Doc for trip itinerary", details: "Danny volunteered. Include: daily schedule, hotel bookings, restaurant reservations, transportation (JR Pass), budget tracker, packing list.", size: "small", source: "ai", completed: true },
  { id: TRIP_TASK_IDS.visa, text: "Check advance parole requirements for H-1B re-entry", details: "Priya needs to verify with immigration lawyer whether she needs advance parole to re-enter US on H-1B after Japan trip. Time-sensitive — may affect whether she can join.", size: "large", source: "ai" },
];

const BRAIN_TASKS: TaskSeed[] = [
  { text: "Build photo recognition prototype with Claude API", details: "Quick prototype to test ingredient detection accuracy from fridge photos. Use Claude's vision capabilities. Measure: how many ingredients correctly identified, false positives, missed items.", size: "large", source: "ai" },
  { text: "Interview 10 target users about meal planning pain points", details: "5 parents, 5 young professionals. Key questions: how they decide what to cook, biggest frustrations, would multi-profile dietary matching change their behavior, willingness to pay.", size: "large", source: "ai" },
  { text: "Check domain availability for supper.app and mise.app", details: "Also check mise.co, getsupper.com, supperapp.com as fallbacks. Register if available and under $50.", size: "small", source: "ai" },
  { text: "Test Spoonacular API compound dietary filtering", details: "Specifically test: can it handle 'dairy-free AND pescatarian AND low-carb' simultaneously? If not, need to build matching layer on top. Document API limitations.", size: "large", source: "ai" },
];

const STUDY_TASKS: TaskSeed[] = [
  { text: "Create Raft vs Paxos vs ZAB comparison table", details: "Cover: leader model, fault tolerance, message complexity, liveness guarantees, real-world implementations (etcd, ZooKeeper, Chubby). Focus on what the exam would ask.", size: "large", source: "ai" },
  { text: "Do practice problems from week 8 problem set", details: "Focus on vector clock exercises and consensus scenarios. Alex will send the problem set. Work through independently then compare answers.", size: "large", source: "manual" },
  { text: "Review Byzantine fault tolerance section", details: "Professor hinted this will be on the exam. Cover: BFT vs CFT, 3f+1 requirement proof intuition, PBFT basics, why most practical systems avoid BFT.", size: "large", source: "ai" },
  { text: "Solve the uncommitted log entry problem from homework", details: "The scenario where a leader crashes after replicating to minority. Need to trace through what happens during re-election and how the new leader handles the uncommitted entry.", size: "small", source: "manual" },
];

const MEETING_TASKS: TaskSeed[] = [
  { id: MEETING_TASK_IDS.oauth, text: "Roll out OAuth2 to 100% of users", details: "Remove feature flag, monitor error rates and login success metrics for 48 hours. Have rollback plan ready. Sarah owns this.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.dashboardPerf, text: "Benchmark materialized views for the analytics dashboard", details: "Currently 8 seconds load time. Evaluate materialized views in Postgres with scheduled refresh vs Redis caching. Sarah taking this — target sub-2-second load.", size: "large", source: "ai", completed: true },
  { id: MEETING_TASK_IDS.stripeInvoicing, text: "Complete Stripe invoicing integration", details: "Blocked on legal sign-off for tax calculation. Once unblocked, swap in real tax rates and test with approved config. Jake estimates 2 days of work.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.migrationGuide, text: "Write API migration guide for auth changes", details: "Document breaking changes in auth flow for API consumers. Sarah to draft by Wednesday. Include: new endpoints, token format changes, migration steps.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.datadog, text: "Set up Datadog initial integration", details: "Jake's stretch goal. Install agent, configure APM tracing, set up basic dashboards for API latency and error rates. Timebox to 1 day.", size: "large", source: "ai" },
  { id: MEETING_TASK_IDS.webhookAlerting, text: "Add alerting on webhook processor queue depth", details: "Post-incident action item from Tuesday's outage. Need alerts when queue depth exceeds threshold. Prevents silent failures.", size: "small", source: "ai" },
  { id: MEETING_TASK_IDS.postmortem, text: "Write postmortem for Friday's webhook processor outage", details: "45 minutes of downtime, lost batch of Stripe events. Root cause: migration locked webhooks table. Include timeline, impact, remediation steps, and prevention measures.", size: "large", source: "ai", completed: true },
  { id: MEETING_TASK_IDS.datadogPricing, text: "Compare Datadog pricing tiers", details: "Team discussed Datadog vs Grafana Cloud. Need detailed pricing comparison for 6 hosts with APM tracing. Factor in engineering time savings.", size: "large", source: "ai", completed: true },
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
    overallNarrative: "Three agents completed research and documentation tasks from the sprint review meeting. The materialized views research agent provided a clear recommendation with implementation steps, the postmortem agent drafted a comprehensive incident report, and the monitoring comparison agent delivered a detailed cost-benefit analysis that supports the team's decision to adopt Datadog. Together, these agents saved approximately 3-4 hours of manual research and writing time.",
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
    ],
    coverageGaps: [
      "No agent investigated the OAuth2 multi-tab token refresh edge case — this could use dedicated testing",
      "The Stripe invoicing blocker (legal approval) wasn't addressed since it requires human escalation",
    ],
    nextSteps: [
      "Implement the materialized view based on Agent 1's recommendation — estimated 1 day of work",
      "Share the postmortem draft with the team and schedule a 30-minute review meeting",
      "Begin Datadog setup using the pricing tier recommended by Agent 3",
    ],
    generatedAt: baseTs + 85_000,
    totalAgents: 3,
    succeededAgents: 3,
    failedAgents: 0,
    totalDurationSecs: 180,
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
// Main seed function
// ===========================================================================
export function seedDemoData(db: Database.Database): void {
  const BASE_TS = Date.now();
  const TRIP_START = BASE_TS - 45 * 60_000;
  const BRAIN_START = BASE_TS - 40 * 60_000;
  const STUDY_START = BASE_TS - 35 * 60_000;
  const MEETING_START = BASE_TS - 30 * 60_000;

  const insertAll = db.transaction(() => {
    // Create sessions
    insertSession(db, TRIP_SESSION_ID, "Japan Trip Planning", TRIP_START, TRIP_START, 0, "en", "ja");
    insertSession(db, BRAIN_SESSION_ID, "AI Recipe App Brainstorm", BRAIN_START, BRAIN_START, 0, "en", "");
    insertSession(db, STUDY_SESSION_ID, "Distributed Systems Exam Prep", STUDY_START, STUDY_START, 0, "en", "");
    insertSession(db, MEETING_SESSION_ID, "Sprint Review & Planning", MEETING_START, MEETING_START, 0, "en", "");

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

    // Insert agents
    const demoAgents = buildAgents(MEETING_START);
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

    // Insert agents fleet summary for MEETING
    const agentsSummary = buildMeetingAgentsSummary(MEETING_START);
    updateSessionAgentsSummary(
      db,
      MEETING_SESSION_ID,
      JSON.stringify(agentsSummary),
      agentsSummary.generatedAt,
    );
  });

  insertAll();
}
