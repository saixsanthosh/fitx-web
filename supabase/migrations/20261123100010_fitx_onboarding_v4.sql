-- FITX onboarding v4 and Home's quote of the day (wave 1 of the "next level" job, onboarding-home stream).
--
-- 1. public.daily_quotes: the quote library (372 original FITX lines, the same rows as src/data/quotes.ts;
--    tests/home-quote/quote-sql.test.mjs keeps the two identical). Readable by signed-in members; written only
--    by migrations.
-- 2. public.daily_quote_history: which quote each member saw on each local day. Primary key (user_id,
--    local_date), unique (user_id, quote_id): a quote is never shown twice to one member. Members read their
--    own rows; only fitx_daily_quote writes them. Joins the member write budget.
-- 3. public.fitx_daily_quote(p_local_date, p_avoid): the signed-in member's quote for that day. The same quote
--    for the same day on every call; otherwise the next unseen quote (a fixed shuffle per member and day,
--    preferring quotes this browser showed before the migration last), and after the whole library has been
--    seen, the quote seen longest ago (its old history row moves to the new day).
--
-- Additive and re-runnable: create if not exists, create or replace, on conflict, guarded do blocks. Onboarding
-- itself needs no schema change: it saves the same profile and preference columns as before.

-- 1. The library -------------------------------------------------------------------------------------------

create table if not exists public.daily_quotes (
  id text primary key,
  text text not null,
  author text,
  source text,
  theme text not null,
  scene text not null,
  position integer not null,
  constraint daily_quotes_id_check check (id ~ '^[a-z]{3}-[0-9]{3}$'),
  constraint daily_quotes_text_check check (pg_catalog.length(text) between 1 and 300),
  constraint daily_quotes_theme_check check (theme in ('discipline', 'consistency', 'strength', 'mind', 'growth', 'recovery')),
  constraint daily_quotes_source_check check (author is null or source is not null)
);

alter table public.daily_quotes enable row level security;
revoke all on table public.daily_quotes from public, anon, authenticated;
grant select on table public.daily_quotes to authenticated;

drop policy if exists daily_quotes_read on public.daily_quotes;
create policy daily_quotes_read on public.daily_quotes for select to authenticated using (true);

comment on table public.daily_quotes is
  'Home''s quote library (original FITX lines; a quote credited to a person needs its source). Same rows as src/data/quotes.ts (20261123100010).';

insert into public.daily_quotes (id, text, author, source, theme, scene, position) values
  ('dis-001', 'The alarm is not a question. Get up and answer it anyway.', null, null, 'discipline', 'dawn-road', 1),
  ('dis-002', 'Motivation opens the door. Discipline walks through it every morning.', null, null, 'discipline', 'chalk-bar', 2),
  ('dis-003', 'Nobody is coming to do your reps for you. That is the good news.', null, null, 'discipline', 'dawn-road', 3),
  ('dis-004', 'Show up on the days you don’t feel like it. Those days count double.', null, null, 'discipline', 'chalk-bar', 4),
  ('dis-005', 'You don’t need a perfect plan. You need to start the one you have.', null, null, 'discipline', 'dawn-road', 5),
  ('dis-006', 'Lace up before the excuses wake up.', null, null, 'discipline', 'chalk-bar', 6),
  ('dis-007', 'Your future self is watching what you do at six in the morning.', null, null, 'discipline', 'dawn-road', 7),
  ('dis-008', 'Small promises kept to yourself build the strongest trust you’ll ever have.', null, null, 'discipline', 'chalk-bar', 8),
  ('dis-009', 'Do the boring work. Boring work builds remarkable people.', null, null, 'discipline', 'dawn-road', 9),
  ('dis-010', 'The plan only works if you do.', null, null, 'discipline', 'chalk-bar', 10),
  ('dis-011', 'Comfort is a fine place to visit. Don’t build your house there.', null, null, 'discipline', 'dawn-road', 11),
  ('dis-012', 'Earn the rest. Then take it without guilt.', null, null, 'discipline', 'chalk-bar', 12),
  ('dis-013', 'Decide once. Then stop renegotiating with yourself every morning.', null, null, 'discipline', 'dawn-road', 13),
  ('dis-014', 'Every rep you finish when it’s hard is a vote for who you’re becoming.', null, null, 'discipline', 'chalk-bar', 14),
  ('dis-015', 'Discipline is remembering what you want when it’s inconvenient.', null, null, 'discipline', 'dawn-road', 15),
  ('dis-016', 'Make the first set non-negotiable. The rest usually follows.', null, null, 'discipline', 'chalk-bar', 16),
  ('dis-017', 'Excuses are loud. Progress is quiet. Listen for the quiet.', null, null, 'discipline', 'dawn-road', 17),
  ('dis-018', 'The hardest part of the session is the walk to the door.', null, null, 'discipline', 'chalk-bar', 18),
  ('dis-019', 'Set the bar where it scares you a little, then go to work.', null, null, 'discipline', 'dawn-road', 19),
  ('dis-020', 'Do it tired. Do it slowly. Just don’t skip it.', null, null, 'discipline', 'chalk-bar', 20),
  ('dis-021', 'Good habits are built on the days nobody claps.', null, null, 'discipline', 'dawn-road', 21),
  ('dis-022', 'Your goals don’t care about your mood. Train anyway.', null, null, 'discipline', 'chalk-bar', 22),
  ('dis-023', 'Five minutes is better than zero. Zero never changed anyone.', null, null, 'discipline', 'dawn-road', 23),
  ('dis-024', 'Win the morning and the day has less room to beat you.', null, null, 'discipline', 'chalk-bar', 24),
  ('dis-025', 'The bar doesn’t know your excuses. It only knows whether you lifted it.', null, null, 'discipline', 'dawn-road', 25),
  ('dis-026', 'Routine is freedom in disguise. You stop deciding and start doing.', null, null, 'discipline', 'chalk-bar', 26),
  ('dis-027', 'Treat today’s session like an appointment with someone you respect.', null, null, 'discipline', 'dawn-road', 27),
  ('dis-028', 'Pack the bag tonight. Tomorrow’s you will thank you.', null, null, 'discipline', 'chalk-bar', 28),
  ('dis-029', 'Stop waiting to feel ready. Ready is something you become by doing.', null, null, 'discipline', 'dawn-road', 29),
  ('dis-030', 'Discipline is a bridge you build one plank at a time.', null, null, 'discipline', 'chalk-bar', 30),
  ('dis-031', 'Say no to one small thing today so you can say yes to a big one later.', null, null, 'discipline', 'dawn-road', 31),
  ('dis-032', 'The work is the shortcut.', null, null, 'discipline', 'chalk-bar', 32),
  ('dis-033', 'Keep the promise even when nobody else would know you broke it.', null, null, 'discipline', 'dawn-road', 33),
  ('dis-034', 'Tidy kitchen, packed bag, early night. Tomorrow starts now.', null, null, 'discipline', 'chalk-bar', 34),
  ('dis-035', 'A strong body is built by a stubborn mind.', null, null, 'discipline', 'dawn-road', 35),
  ('dis-036', 'Skip the snooze. Take the win.', null, null, 'discipline', 'chalk-bar', 36),
  ('dis-037', 'You can be tired and still be unstoppable.', null, null, 'discipline', 'dawn-road', 37),
  ('dis-038', 'If it matters, put it in the diary. If it’s in the diary, do it.', null, null, 'discipline', 'chalk-bar', 38),
  ('dis-039', 'Today’s effort is tomorrow’s baseline.', null, null, 'discipline', 'dawn-road', 39),
  ('dis-040', 'Don’t negotiate with the version of you that wants to quit.', null, null, 'discipline', 'chalk-bar', 40),
  ('dis-041', 'Clock in on yourself today.', null, null, 'discipline', 'dawn-road', 41),
  ('dis-042', 'Excellence is a quiet repetition of ordinary things done well.', null, null, 'discipline', 'chalk-bar', 42),
  ('dis-043', 'There’s no secret. There’s just Tuesday, and you showing up for it.', null, null, 'discipline', 'dawn-road', 43),
  ('dis-044', 'Rain, cold, dark: the weather is rarely the real reason.', null, null, 'discipline', 'chalk-bar', 44),
  ('dis-045', 'Start before you’re comfortable. Comfort comes later.', null, null, 'discipline', 'dawn-road', 45),
  ('dis-046', 'The minutes you least want to train are the ones that change you.', null, null, 'discipline', 'chalk-bar', 46),
  ('dis-047', 'Hold the line on the small things and the big things hold themselves.', null, null, 'discipline', 'dawn-road', 47),
  ('dis-048', 'Your word to yourself is the first contract you sign each day.', null, null, 'discipline', 'chalk-bar', 48),
  ('dis-049', 'Leave your shoes by the door. Make starting the easiest thing you do.', null, null, 'discipline', 'dawn-road', 49),
  ('dis-050', 'Do the warm-up. Respect the process and it respects you back.', null, null, 'discipline', 'chalk-bar', 50),
  ('dis-051', 'Doubt is allowed in the room. It just doesn’t get to hold the bar.', null, null, 'discipline', 'dawn-road', 51),
  ('dis-052', 'Focus on the next rep, not the whole mountain.', null, null, 'discipline', 'chalk-bar', 52),
  ('dis-053', 'Effort is the one thing in this room you fully control.', null, null, 'discipline', 'dawn-road', 53),
  ('dis-054', 'Turn “I should” into “I did” before lunch.', null, null, 'discipline', 'chalk-bar', 54),
  ('dis-055', 'Build the habit first. Perfect it later.', null, null, 'discipline', 'dawn-road', 55),
  ('dis-056', 'One missed day is a pause. Don’t let it become a decision.', null, null, 'discipline', 'chalk-bar', 56),
  ('dis-057', 'Get in, do the work, go home proud.', null, null, 'discipline', 'dawn-road', 57),
  ('dis-058', 'Discipline is self-respect in practice.', null, null, 'discipline', 'chalk-bar', 58),
  ('dis-059', 'Make today’s choice the one you’d happily repeat tomorrow.', null, null, 'discipline', 'dawn-road', 59),
  ('dis-060', 'Nobody regrets the session they finished.', null, null, 'discipline', 'chalk-bar', 60),
  ('dis-061', 'Sharpen the routine, not the excuse.', null, null, 'discipline', 'dawn-road', 61),
  ('dis-062', 'Today is a good day to keep a promise.', null, null, 'discipline', 'chalk-bar', 62),
  ('con-001', 'Small steps every day add up to a distance you can’t believe.', null, null, 'consistency', 'stadium-steps', 63),
  ('con-002', 'You don’t have to be extreme. You just have to be consistent.', null, null, 'consistency', 'rain-track', 64),
  ('con-003', 'One good week is a start. Fifty-two of them is a new life.', null, null, 'consistency', 'stadium-steps', 65),
  ('con-004', 'Progress hides in the days that feel like nothing happened.', null, null, 'consistency', 'rain-track', 66),
  ('con-005', 'Show up, log it, go again tomorrow.', null, null, 'consistency', 'stadium-steps', 67),
  ('con-006', 'The streak isn’t the goal. The person who keeps it is.', null, null, 'consistency', 'rain-track', 68),
  ('con-007', 'Water the habit every day, even when nothing seems to grow.', null, null, 'consistency', 'stadium-steps', 69),
  ('con-008', 'Consistency beats intensity every time it’s tested.', null, null, 'consistency', 'rain-track', 70),
  ('con-009', 'Average effort repeated for a year beats heroic effort for a week.', null, null, 'consistency', 'stadium-steps', 71),
  ('con-010', 'Don’t chase a perfect week. Chase a good one, again and again.', null, null, 'consistency', 'rain-track', 72),
  ('con-011', 'Ten minutes a day is more than an hour once a month.', null, null, 'consistency', 'stadium-steps', 73),
  ('con-012', 'The quiet days are where the work really happens.', null, null, 'consistency', 'rain-track', 74),
  ('con-013', 'Missed yesterday? Today is the comeback. No drama needed.', null, null, 'consistency', 'stadium-steps', 75),
  ('con-014', 'Same time, same place, same promise. Let the routine carry you.', null, null, 'consistency', 'rain-track', 76),
  ('con-015', 'Results arrive slowly, then all at once. Keep going.', null, null, 'consistency', 'stadium-steps', 77),
  ('con-016', 'The habit you keep is stronger than the plan you dream about.', null, null, 'consistency', 'rain-track', 78),
  ('con-017', 'Every session is a brick. Keep laying them.', null, null, 'consistency', 'stadium-steps', 79),
  ('con-018', 'Steady wins. Steady nearly always wins.', null, null, 'consistency', 'rain-track', 80),
  ('con-019', 'Count your sessions, not your setbacks.', null, null, 'consistency', 'stadium-steps', 81),
  ('con-020', 'Your body keeps score of what you do most often.', null, null, 'consistency', 'rain-track', 82),
  ('con-021', 'Make it so easy to start that stopping feels strange.', null, null, 'consistency', 'stadium-steps', 83),
  ('con-022', 'It’s not about the big day. It’s about the next ordinary one.', null, null, 'consistency', 'rain-track', 84),
  ('con-023', 'Keep the chain unbroken, even if today’s link is small.', null, null, 'consistency', 'stadium-steps', 85),
  ('con-024', 'A walk still counts. A short session still counts. Showing up counts.', null, null, 'consistency', 'rain-track', 86),
  ('con-025', 'The secret is that there isn’t one. Just repetition.', null, null, 'consistency', 'stadium-steps', 87),
  ('con-026', 'Momentum is earned daily and lost quietly. Guard it.', null, null, 'consistency', 'rain-track', 88),
  ('con-027', 'Rhythm first. Records later.', null, null, 'consistency', 'stadium-steps', 89),
  ('con-028', 'Be the person who simply doesn’t miss.', null, null, 'consistency', 'rain-track', 90),
  ('con-029', 'Habits are the interest on the effort you invest today.', null, null, 'consistency', 'stadium-steps', 91),
  ('con-030', 'Plain meals, steady sleep, regular training. Unglamorous and unbeatable.', null, null, 'consistency', 'rain-track', 92),
  ('con-031', 'Tomorrow gets easier because you did today.', null, null, 'consistency', 'stadium-steps', 93),
  ('con-032', 'Track it honestly. What you measure, you can move.', null, null, 'consistency', 'rain-track', 94),
  ('con-033', 'Little by little becomes a lot.', null, null, 'consistency', 'stadium-steps', 95),
  ('con-034', 'Do the same good thing long enough and it becomes who you are.', null, null, 'consistency', 'rain-track', 96),
  ('con-035', 'Patience is consistency with a longer view.', null, null, 'consistency', 'stadium-steps', 97),
  ('con-036', 'You won’t feel the difference today. You’ll see it in a season.', null, null, 'consistency', 'rain-track', 98),
  ('con-037', 'Repeat the basics until they’re boring, then repeat them again.', null, null, 'consistency', 'stadium-steps', 99),
  ('con-038', 'Consistency is a promise you keep in instalments.', null, null, 'consistency', 'rain-track', 100),
  ('con-039', 'Don’t break the routine to celebrate. Let the routine be the celebration.', null, null, 'consistency', 'stadium-steps', 101),
  ('con-040', 'The hundredth session matters as much as the first.', null, null, 'consistency', 'rain-track', 102),
  ('con-041', 'Keep going when it’s dull. Dull is where depth comes from.', null, null, 'consistency', 'stadium-steps', 103),
  ('con-042', 'There’s always time for a little. A little, often, is plenty.', null, null, 'consistency', 'rain-track', 104),
  ('con-043', 'The road is long because it’s worth it.', null, null, 'consistency', 'stadium-steps', 105),
  ('con-044', 'One more week. Then decide whether to keep going. You will.', null, null, 'consistency', 'rain-track', 106),
  ('con-045', 'Your best results live on the far side of many average days.', null, null, 'consistency', 'stadium-steps', 107),
  ('con-046', 'Habits don’t need applause. They need repetition.', null, null, 'consistency', 'rain-track', 108),
  ('con-047', 'Train like this session is one page of a much bigger story.', null, null, 'consistency', 'stadium-steps', 109),
  ('con-048', 'Slow progress is still progress. Quick quitting is still quitting.', null, null, 'consistency', 'rain-track', 110),
  ('con-049', 'Every early morning is a deposit. The account grows quietly.', null, null, 'consistency', 'stadium-steps', 111),
  ('con-050', 'Make your routine sturdy enough to survive a bad day.', null, null, 'consistency', 'rain-track', 112),
  ('con-051', 'Even on holiday, move a little. The habit travels with you.', null, null, 'consistency', 'stadium-steps', 113),
  ('con-052', 'Seasons change. The habit stays.', null, null, 'consistency', 'rain-track', 114),
  ('con-053', 'The calendar is your training partner. Fill it honestly.', null, null, 'consistency', 'stadium-steps', 115),
  ('con-054', 'Pick a pace you can keep, and keep it.', null, null, 'consistency', 'rain-track', 116),
  ('con-055', 'Lasting change is rarely loud.', null, null, 'consistency', 'stadium-steps', 117),
  ('con-056', 'Keep the promise small enough to keep every day.', null, null, 'consistency', 'rain-track', 118),
  ('con-057', 'Steady hands build strong things.', null, null, 'consistency', 'stadium-steps', 119),
  ('con-058', 'A habit is just an ordinary day, repeated on purpose.', null, null, 'consistency', 'rain-track', 120),
  ('con-059', 'Repetition is how the body learns and how the mind believes.', null, null, 'consistency', 'stadium-steps', 121),
  ('con-060', 'Turn up today. That’s the whole plan.', null, null, 'consistency', 'rain-track', 122),
  ('con-061', 'Consistency is the quiet superpower nobody posts about.', null, null, 'consistency', 'stadium-steps', 123),
  ('con-062', 'Stack good days like plates on a bar.', null, null, 'consistency', 'rain-track', 124),
  ('str-001', 'Strong is built, not born.', null, null, 'strength', 'iron-room', 125),
  ('str-002', 'Lift with intent. Rest with purpose. Repeat with patience.', null, null, 'strength', 'heavy-bag', 126),
  ('str-003', 'The weight is only heavy until you are stronger.', null, null, 'strength', 'iron-room', 127),
  ('str-004', 'Strength is the result of a thousand quiet decisions.', null, null, 'strength', 'heavy-bag', 128),
  ('str-005', 'Earn your strength one clean rep at a time.', null, null, 'strength', 'iron-room', 129),
  ('str-006', 'Your body can carry more than your doubts tell you.', null, null, 'strength', 'heavy-bag', 130),
  ('str-007', 'Respect the weight. Then move it.', null, null, 'strength', 'iron-room', 131),
  ('str-008', 'Hard sets reveal you. Honest sets build you.', null, null, 'strength', 'heavy-bag', 132),
  ('str-009', 'Every plate you add was once a weight you feared.', null, null, 'strength', 'iron-room', 133),
  ('str-010', 'Grip it, brace it, own it.', null, null, 'strength', 'heavy-bag', 134),
  ('str-011', 'Strength isn’t loud. It’s steady, deliberate and patient.', null, null, 'strength', 'iron-room', 135),
  ('str-012', 'Form first, ego last, progress always.', null, null, 'strength', 'heavy-bag', 136),
  ('str-013', 'Muscles grow in rest, but they’re earned in effort.', null, null, 'strength', 'iron-room', 137),
  ('str-014', 'The last rep is where strength decides to stay.', null, null, 'strength', 'heavy-bag', 138),
  ('str-015', 'Stand tall. You’ve lifted harder things than this.', null, null, 'strength', 'iron-room', 139),
  ('str-016', 'Being strong is useful every single day of your life.', null, null, 'strength', 'heavy-bag', 140),
  ('str-017', 'Load the bar with patience, not pride.', null, null, 'strength', 'iron-room', 141),
  ('str-018', 'Today’s best lift is a future warm-up.', null, null, 'strength', 'heavy-bag', 142),
  ('str-019', 'Strong legs carry you further in every part of life.', null, null, 'strength', 'iron-room', 143),
  ('str-020', 'Strength is the ability to keep going after it stops being fun.', null, null, 'strength', 'heavy-bag', 144),
  ('str-021', 'Lift something today that yesterday’s you couldn’t.', null, null, 'strength', 'iron-room', 145),
  ('str-022', 'Power comes from the ground up. So does confidence.', null, null, 'strength', 'heavy-bag', 146),
  ('str-023', 'Brace your core and your resolve together.', null, null, 'strength', 'iron-room', 147),
  ('str-024', 'Train for the strength you’ll want at eighty.', null, null, 'strength', 'heavy-bag', 148),
  ('str-025', 'There’s no shortcut to a strong back, only good rows.', null, null, 'strength', 'iron-room', 149),
  ('str-026', 'Heavy days teach you who you are.', null, null, 'strength', 'heavy-bag', 150),
  ('str-027', 'Strength shows up long before the mirror notices.', null, null, 'strength', 'iron-room', 151),
  ('str-028', 'The bar is honest. It always tells you where you stand.', null, null, 'strength', 'heavy-bag', 152),
  ('str-029', 'Pick it up with care. Put it down with control.', null, null, 'strength', 'iron-room', 153),
  ('str-030', 'A strong body makes a calm mind braver.', null, null, 'strength', 'heavy-bag', 154),
  ('str-031', 'You get stronger by doing slightly more than last time.', null, null, 'strength', 'iron-room', 155),
  ('str-032', 'Your best lift is a well-executed one, not just a heavy one.', null, null, 'strength', 'heavy-bag', 156),
  ('str-033', 'Chalk up. Breathe. Lift.', null, null, 'strength', 'iron-room', 157),
  ('str-034', 'Strength is earned in sets of five and kept for a lifetime.', null, null, 'strength', 'heavy-bag', 158),
  ('str-035', 'Every strong person started by lifting something light, well.', null, null, 'strength', 'iron-room', 159),
  ('str-036', 'Build a body that can handle whatever the day throws at it.', null, null, 'strength', 'heavy-bag', 160),
  ('str-037', 'Effort makes strength. Rest makes it last.', null, null, 'strength', 'iron-room', 161),
  ('str-038', 'The iron is patient. Be patient with it.', null, null, 'strength', 'heavy-bag', 162),
  ('str-039', 'Strong is a feeling before it’s a number.', null, null, 'strength', 'iron-room', 163),
  ('str-040', 'Lift the weight you can control, then earn the one you can’t.', null, null, 'strength', 'heavy-bag', 164),
  ('str-041', 'Gentle with yourself, firm with the bar.', null, null, 'strength', 'iron-room', 165),
  ('str-042', 'Strength grows where comfort ends and good form begins.', null, null, 'strength', 'heavy-bag', 166),
  ('str-043', 'Carry the shopping in one trip. Strength has everyday perks.', null, null, 'strength', 'iron-room', 167),
  ('str-044', 'It’s not the weight that matters. It’s that you keep coming back to it.', null, null, 'strength', 'heavy-bag', 168),
  ('str-045', 'Stronger hands, steadier heart.', null, null, 'strength', 'iron-room', 169),
  ('str-046', 'A little more than last time: the oldest promise in training.', null, null, 'strength', 'heavy-bag', 170),
  ('str-047', 'Your back will thank you for every lift done right.', null, null, 'strength', 'iron-room', 171),
  ('str-048', 'One good set beats three sloppy ones.', null, null, 'strength', 'heavy-bag', 172),
  ('str-049', 'Strength is knowing when to push and when to put it down.', null, null, 'strength', 'iron-room', 173),
  ('str-050', 'The heaviest lift is often just getting under the bar.', null, null, 'strength', 'heavy-bag', 174),
  ('str-051', 'Real strength makes room to help others carry theirs.', null, null, 'strength', 'iron-room', 175),
  ('str-052', 'Big lifts are built on small, careful reps.', null, null, 'strength', 'heavy-bag', 176),
  ('str-053', 'Strong today. Stronger by choice tomorrow.', null, null, 'strength', 'iron-room', 177),
  ('str-054', 'Move with power. Land with control.', null, null, 'strength', 'heavy-bag', 178),
  ('str-055', 'Leave one rep in the tank and come back stronger next week.', null, null, 'strength', 'iron-room', 179),
  ('str-056', 'Strength isn’t a size. It’s a capability.', null, null, 'strength', 'heavy-bag', 180),
  ('str-057', 'Push the floor away. Feel how solid you are.', null, null, 'strength', 'iron-room', 181),
  ('str-058', 'Every pull-up starts with a single hang. Begin there.', null, null, 'strength', 'heavy-bag', 182),
  ('str-059', 'The weight never lies, and neither does your effort.', null, null, 'strength', 'iron-room', 183),
  ('str-060', 'Rebuild yourself one session at a time, stronger each round.', null, null, 'strength', 'heavy-bag', 184),
  ('str-061', 'Steel sharpens with use. So do you.', null, null, 'strength', 'iron-room', 185),
  ('str-062', 'Strong mind, strong grip, strong finish.', null, null, 'strength', 'heavy-bag', 186),
  ('min-001', 'Breathe in for four. Out for six. Begin again.', null, null, 'mind', 'lake-dawn', 187),
  ('min-002', 'A walk can’t fix everything, but it rarely makes anything worse.', null, null, 'mind', 'pine-light', 188),
  ('min-003', 'Be as kind to your mind as you are demanding of your training.', null, null, 'mind', 'lake-dawn', 189),
  ('min-004', 'Clear head, steady steps. Let the movement settle the noise.', null, null, 'mind', 'pine-light', 190),
  ('min-005', 'You don’t have to feel brilliant to do something good for yourself.', null, null, 'mind', 'lake-dawn', 191),
  ('min-006', 'Notice one good thing your body did today.', null, null, 'mind', 'pine-light', 192),
  ('min-007', 'Aim for better, not flawless. Your mind deserves the same grace as your body.', null, null, 'mind', 'lake-dawn', 193),
  ('min-008', 'Ten minutes outside can change the shape of a whole day.', null, null, 'mind', 'pine-light', 194),
  ('min-009', 'Training is a conversation between mind and body. Listen to both.', null, null, 'mind', 'lake-dawn', 195),
  ('min-010', 'Quiet the scroll. Hear your breath.', null, null, 'mind', 'pine-light', 196),
  ('min-011', 'Some days the win is simply getting out of the door.', null, null, 'mind', 'lake-dawn', 197),
  ('min-012', 'Talk to yourself like a good friend would at the start line.', null, null, 'mind', 'pine-light', 198),
  ('min-013', 'Calm is a skill. Practise it like any other.', null, null, 'mind', 'lake-dawn', 199),
  ('min-014', 'Movement is a reset button you can press any time.', null, null, 'mind', 'pine-light', 200),
  ('min-015', 'Your worth is not measured on a scale.', null, null, 'mind', 'lake-dawn', 201),
  ('min-016', 'Slow down enough to notice how far you’ve come.', null, null, 'mind', 'pine-light', 202),
  ('min-017', 'Being gentle with yourself is not the same as giving up.', null, null, 'mind', 'lake-dawn', 203),
  ('min-018', 'Feel your feet on the ground. You’re here. That’s enough to start.', null, null, 'mind', 'pine-light', 204),
  ('min-019', 'A focused mind lifts more than a hurried one.', null, null, 'mind', 'lake-dawn', 205),
  ('min-020', 'It’s fine to ask for help. Strong people do it all the time.', null, null, 'mind', 'pine-light', 206),
  ('min-021', 'One deep breath before the set. One after. Every time.', null, null, 'mind', 'lake-dawn', 207),
  ('min-022', 'You can carry stress, or you can move it. Choose to move it.', null, null, 'mind', 'pine-light', 208),
  ('min-023', 'Your progress is yours alone. Measure it against yesterday, nothing else.', null, null, 'mind', 'lake-dawn', 209),
  ('min-024', 'Fresh air, a few kilometres and a clearer mind.', null, null, 'mind', 'pine-light', 210),
  ('min-025', 'Be present for this rep. The rest of the day can wait.', null, null, 'mind', 'lake-dawn', 211),
  ('min-026', 'A good session is as much about how you feel as what you lift.', null, null, 'mind', 'pine-light', 212),
  ('min-027', 'Let the heavy thoughts walk with you. They often get lighter on the way.', null, null, 'mind', 'lake-dawn', 213),
  ('min-028', 'Calm is not the absence of effort. It’s effort without panic.', null, null, 'mind', 'pine-light', 214),
  ('min-029', 'Mind the basics: sleep, water, daylight, movement.', null, null, 'mind', 'lake-dawn', 215),
  ('min-030', 'Focus is a muscle. Train it gently every day.', null, null, 'mind', 'pine-light', 216),
  ('min-031', 'You’re allowed to start again as many times as you need.', null, null, 'mind', 'lake-dawn', 217),
  ('min-032', 'Breathe through the burn. The breath is your anchor.', null, null, 'mind', 'pine-light', 218),
  ('min-033', 'Celebrate effort. The outcome keeps its own timetable.', null, null, 'mind', 'lake-dawn', 219),
  ('min-034', 'When your head is full, let your legs empty it.', null, null, 'mind', 'pine-light', 220),
  ('min-035', 'Make space for stillness. Strength needs it.', null, null, 'mind', 'lake-dawn', 221),
  ('min-036', 'Unplug, lace up and let your thoughts find their own pace.', null, null, 'mind', 'pine-light', 222),
  ('min-037', 'Confidence is built from small kept promises, not big speeches.', null, null, 'mind', 'lake-dawn', 223),
  ('min-038', 'Your best is different every day. Today’s best is enough.', null, null, 'mind', 'pine-light', 224),
  ('min-039', 'Patience with yourself is a training method too.', null, null, 'mind', 'lake-dawn', 225),
  ('min-040', 'Look up from the screen. The horizon is good for you.', null, null, 'mind', 'pine-light', 226),
  ('min-041', 'There’s courage in the quiet decision to keep going.', null, null, 'mind', 'lake-dawn', 227),
  ('min-042', 'Notice the tension in your shoulders. Let it drop.', null, null, 'mind', 'pine-light', 228),
  ('min-043', 'A clear mind starts with a single slow breath.', null, null, 'mind', 'lake-dawn', 229),
  ('min-044', 'Kindness to yourself is not weakness. It’s maintenance.', null, null, 'mind', 'pine-light', 230),
  ('min-045', 'Train to feel alive, not just to look different.', null, null, 'mind', 'lake-dawn', 231),
  ('min-046', 'The mind often tires before the body. Learn the difference.', null, null, 'mind', 'pine-light', 232),
  ('min-047', 'Gratitude for what your body can do changes what it does next.', null, null, 'mind', 'lake-dawn', 233),
  ('min-048', 'Bad day? Move a little. Then decide how bad it really is.', null, null, 'mind', 'pine-light', 234),
  ('min-049', 'Let today’s session be a break from worrying, not another worry.', null, null, 'mind', 'lake-dawn', 235),
  ('min-050', 'Stillness after effort is where calm settles in.', null, null, 'mind', 'pine-light', 236),
  ('min-051', 'Your pace, your path, your progress.', null, null, 'mind', 'lake-dawn', 237),
  ('min-052', 'Say something encouraging to yourself before you begin.', null, null, 'mind', 'pine-light', 238),
  ('min-053', 'Thoughts come and go. The breath stays. Follow the breath.', null, null, 'mind', 'lake-dawn', 239),
  ('min-054', 'Strong mind, soft heart, steady habits.', null, null, 'mind', 'pine-light', 240),
  ('min-055', 'Doubt shrinks when you move towards it.', null, null, 'mind', 'lake-dawn', 241),
  ('min-056', 'Leave the phone in the bag for this one. Be fully here.', null, null, 'mind', 'pine-light', 242),
  ('min-057', 'The calm you build on the mat follows you home.', null, null, 'mind', 'lake-dawn', 243),
  ('min-058', 'Not every session has to be a battle. Some can be a meditation.', null, null, 'mind', 'pine-light', 244),
  ('min-059', 'Be curious about your limits instead of afraid of them.', null, null, 'mind', 'lake-dawn', 245),
  ('min-060', 'You are more resilient than this morning’s mood suggests.', null, null, 'mind', 'pine-light', 246),
  ('min-061', 'Clarity often arrives halfway through the walk.', null, null, 'mind', 'lake-dawn', 247),
  ('min-062', 'Look after your mind like the most important muscle you have.', null, null, 'mind', 'pine-light', 248),
  ('gro-001', 'You’re not starting over. You’re starting with experience.', null, null, 'growth', 'ridge-sunrise', 249),
  ('gro-002', 'Every expert was once a beginner who didn’t stop.', null, null, 'growth', 'window-corner', 250),
  ('gro-003', 'Growth is uncomfortable, then it’s simply who you are.', null, null, 'growth', 'ridge-sunrise', 251),
  ('gro-004', 'Be a beginner today. It’s the fastest way to learn.', null, null, 'growth', 'window-corner', 252),
  ('gro-005', 'The person you’re becoming is built in sessions like this one.', null, null, 'growth', 'ridge-sunrise', 253),
  ('gro-006', 'New skill, wobbly start. That’s exactly how it should feel.', null, null, 'growth', 'window-corner', 254),
  ('gro-007', 'Look back a year. That’s proof you can grow again.', null, null, 'growth', 'ridge-sunrise', 255),
  ('gro-008', 'Small improvements, honestly earned, compound into big change.', null, null, 'growth', 'window-corner', 256),
  ('gro-009', 'A failed rep is feedback with a sweat towel.', null, null, 'growth', 'ridge-sunrise', 257),
  ('gro-010', 'You outgrow limits by testing them carefully.', null, null, 'growth', 'window-corner', 258),
  ('gro-011', 'Grow at your own speed. Just keep growing.', null, null, 'growth', 'ridge-sunrise', 259),
  ('gro-012', 'Today, try one thing you’ve never done in a workout.', null, null, 'growth', 'window-corner', 260),
  ('gro-013', 'Plateaus are where the next climb gets planned.', null, null, 'growth', 'ridge-sunrise', 261),
  ('gro-014', 'Your potential isn’t fixed. It responds to effort.', null, null, 'growth', 'window-corner', 262),
  ('gro-015', 'Learn the movement before you load the movement.', null, null, 'growth', 'ridge-sunrise', 263),
  ('gro-016', 'What felt impossible last month is your warm-up now.', null, null, 'growth', 'window-corner', 264),
  ('gro-017', 'The climb is the point. The view is a bonus.', null, null, 'growth', 'ridge-sunrise', 265),
  ('gro-018', 'Be proud of how far you’ve come and curious about how far you’ll go.', null, null, 'growth', 'window-corner', 266),
  ('gro-019', 'Change asks for patience before it gives you proof.', null, null, 'growth', 'ridge-sunrise', 267),
  ('gro-020', 'Every setback holds a lesson. Keep the lesson, leave the setback.', null, null, 'growth', 'window-corner', 268),
  ('gro-021', 'Ask better questions of your training and it gives better answers.', null, null, 'growth', 'ridge-sunrise', 269),
  ('gro-022', 'Growth is choosing the harder lesson over the easier excuse.', null, null, 'growth', 'window-corner', 270),
  ('gro-023', 'A new personal best starts as a new attempt.', null, null, 'growth', 'ridge-sunrise', 271),
  ('gro-024', 'Plant the habit now. Enjoy the shade later.', null, null, 'growth', 'window-corner', 272),
  ('gro-025', 'Don’t fear the slow start. Fear never starting.', null, null, 'growth', 'ridge-sunrise', 273),
  ('gro-026', 'Your body adapts to what you ask of it. Ask for more, kindly.', null, null, 'growth', 'window-corner', 274),
  ('gro-027', 'Every ridge you reach reveals the next one. That’s the adventure.', null, null, 'growth', 'ridge-sunrise', 275),
  ('gro-028', 'You can’t skip chapters, but you can keep turning pages.', null, null, 'growth', 'window-corner', 276),
  ('gro-029', 'Write a better story with this week’s training.', null, null, 'growth', 'ridge-sunrise', 277),
  ('gro-030', 'Grow your skills, not just your numbers.', null, null, 'growth', 'window-corner', 278),
  ('gro-031', 'It takes courage to be bad at something new. Be brave.', null, null, 'growth', 'ridge-sunrise', 279),
  ('gro-032', 'The gap between where you are and where you want to be is called practice.', null, null, 'growth', 'window-corner', 280),
  ('gro-033', 'Progress looks like mistakes made a little better each time.', null, null, 'growth', 'ridge-sunrise', 281),
  ('gro-034', 'Keep a training log. Future you will love reading the early pages.', null, null, 'growth', 'window-corner', 282),
  ('gro-035', 'Stretch your comfort zone a little every week.', null, null, 'growth', 'ridge-sunrise', 283),
  ('gro-036', 'The summit belongs to people who kept walking in the fog.', null, null, 'growth', 'window-corner', 284),
  ('gro-037', 'Today is a good day to raise your own standard.', null, null, 'growth', 'ridge-sunrise', 285),
  ('gro-038', 'Learn from the session that went wrong. It’s a fine teacher.', null, null, 'growth', 'window-corner', 286),
  ('gro-039', 'Grow strong enough to be gentle and fit enough to enjoy life.', null, null, 'growth', 'ridge-sunrise', 287),
  ('gro-040', 'Each season of training builds on the last.', null, null, 'growth', 'window-corner', 288),
  ('gro-041', 'Seek coaching, take feedback, keep improving.', null, null, 'growth', 'ridge-sunrise', 289),
  ('gro-042', 'You’re writing your own fitness history. Make today a good line.', null, null, 'growth', 'window-corner', 290),
  ('gro-043', 'Your body can keep changing at any age.', null, null, 'growth', 'ridge-sunrise', 291),
  ('gro-044', 'Starting late still beats never starting. Begin with this session.', null, null, 'growth', 'window-corner', 292),
  ('gro-045', 'Choose challenges that make you curious, not just tired.', null, null, 'growth', 'ridge-sunrise', 293),
  ('gro-046', 'Growth means trading what’s easy for what’s worthwhile.', null, null, 'growth', 'window-corner', 294),
  ('gro-047', 'Every attempt teaches the body something new.', null, null, 'growth', 'ridge-sunrise', 295),
  ('gro-048', 'Goals point the way. Routines get you there.', null, null, 'growth', 'window-corner', 296),
  ('gro-049', 'Become someone who finishes what they start.', null, null, 'growth', 'ridge-sunrise', 297),
  ('gro-050', 'Improvement doesn’t announce itself. Notice it anyway.', null, null, 'growth', 'window-corner', 298),
  ('gro-051', 'Raise the floor, not just the ceiling.', null, null, 'growth', 'ridge-sunrise', 299),
  ('gro-052', 'Mistakes are the receipts of trying.', null, null, 'growth', 'window-corner', 300),
  ('gro-053', 'Climb steadily. Look back now and then. Smile at the distance.', null, null, 'growth', 'ridge-sunrise', 301),
  ('gro-054', 'Each workout is a rehearsal for the life you want.', null, null, 'growth', 'window-corner', 302),
  ('gro-055', 'You choose the direction. Effort chooses the speed.', null, null, 'growth', 'ridge-sunrise', 303),
  ('gro-056', 'Measure growth in months, not mornings.', null, null, 'growth', 'window-corner', 304),
  ('gro-057', 'Every strong habit started as a fragile one.', null, null, 'growth', 'ridge-sunrise', 305),
  ('gro-058', 'There’s more in you than you’ve asked for so far.', null, null, 'growth', 'window-corner', 306),
  ('gro-059', 'Grow quietly. Let the results speak.', null, null, 'growth', 'ridge-sunrise', 307),
  ('gro-060', 'The path is steep because it leads somewhere worth seeing.', null, null, 'growth', 'window-corner', 308),
  ('gro-061', 'Learn something about your body every week.', null, null, 'growth', 'ridge-sunrise', 309),
  ('gro-062', 'Today’s discomfort is tomorrow’s capability.', null, null, 'growth', 'window-corner', 310),
  ('rec-001', 'Rest is part of the training, not a break from it.', null, null, 'recovery', 'rest-bench', 311),
  ('rec-002', 'Sleep is the most underrated performance plan there is.', null, null, 'recovery', 'pebble-shore', 312),
  ('rec-003', 'Recovery is where the work turns into results.', null, null, 'recovery', 'rest-bench', 313),
  ('rec-004', 'Listen to your body. It’s been talking to you all day.', null, null, 'recovery', 'pebble-shore', 314),
  ('rec-005', 'Drink some water. Your muscles will thank you.', null, null, 'recovery', 'rest-bench', 315),
  ('rec-006', 'A rest day done well is training for tomorrow.', null, null, 'recovery', 'pebble-shore', 316),
  ('rec-007', 'Easy days make the hard days possible.', null, null, 'recovery', 'rest-bench', 317),
  ('rec-008', 'Stretch slowly. There’s nowhere you need to be for ten minutes.', null, null, 'recovery', 'pebble-shore', 318),
  ('rec-009', 'Soreness is information, not a medal.', null, null, 'recovery', 'rest-bench', 319),
  ('rec-010', 'Sharp pain is a stop sign. Respect it.', null, null, 'recovery', 'pebble-shore', 320),
  ('rec-011', 'Recover like you mean it: food, water, sleep, calm.', null, null, 'recovery', 'rest-bench', 321),
  ('rec-012', 'Rest without guilt. You earned it, and you need it.', null, null, 'recovery', 'pebble-shore', 322),
  ('rec-013', 'Strong athletes know when to slow down.', null, null, 'recovery', 'rest-bench', 323),
  ('rec-014', 'A gentle walk on a rest day keeps the engine warm.', null, null, 'recovery', 'pebble-shore', 324),
  ('rec-015', 'Tomorrow’s best effort begins with tonight’s sleep.', null, null, 'recovery', 'rest-bench', 325),
  ('rec-016', 'Breathe out longer than you breathe in, and let your body settle.', null, null, 'recovery', 'pebble-shore', 326),
  ('rec-017', 'Take the stairs slowly today. Recovery has its own pace.', null, null, 'recovery', 'rest-bench', 327),
  ('rec-018', 'Rest is how muscles rebuild. Let them.', null, null, 'recovery', 'pebble-shore', 328),
  ('rec-019', 'A day off now beats a month off later.', null, null, 'recovery', 'rest-bench', 329),
  ('rec-020', 'Look after your joints. You’ll want them for a long time.', null, null, 'recovery', 'pebble-shore', 330),
  ('rec-021', 'Eat well after training. Fuel is part of the work.', null, null, 'recovery', 'rest-bench', 331),
  ('rec-022', 'Slow down to speed up.', null, null, 'recovery', 'pebble-shore', 332),
  ('rec-023', 'Recovery isn’t lazy. It’s strategic.', null, null, 'recovery', 'rest-bench', 333),
  ('rec-024', 'Respect the rest between sets. It’s part of the set.', null, null, 'recovery', 'pebble-shore', 334),
  ('rec-025', 'Gentle movement, deep breathing, early night. Repeat.', null, null, 'recovery', 'rest-bench', 335),
  ('rec-026', 'Your body rebuilds while you rest. Give it the time.', null, null, 'recovery', 'pebble-shore', 336),
  ('rec-027', 'Let today be light. Tomorrow will be stronger for it.', null, null, 'recovery', 'rest-bench', 337),
  ('rec-028', 'Overtraining is not a badge. Balance is.', null, null, 'recovery', 'pebble-shore', 338),
  ('rec-029', 'Take five minutes to cool down. Your future self is grateful.', null, null, 'recovery', 'rest-bench', 339),
  ('rec-030', 'Even the best machines need maintenance. So do you.', null, null, 'recovery', 'pebble-shore', 340),
  ('rec-031', 'A warm shower, a good meal, a long sleep: the recovery stack.', null, null, 'recovery', 'rest-bench', 341),
  ('rec-032', 'Feeling worn down? An easy day is still a good day.', null, null, 'recovery', 'pebble-shore', 342),
  ('rec-033', 'Return from rest hungrier, not guilty.', null, null, 'recovery', 'rest-bench', 343),
  ('rec-034', 'The pause between efforts is where strength settles in.', null, null, 'recovery', 'pebble-shore', 344),
  ('rec-035', 'Rest well, train well, live well.', null, null, 'recovery', 'rest-bench', 345),
  ('rec-036', 'Some days the bravest thing is taking the day off.', null, null, 'recovery', 'pebble-shore', 346),
  ('rec-037', 'Recovery is a skill you can get better at.', null, null, 'recovery', 'rest-bench', 347),
  ('rec-038', 'Your whole system needs rest, not just your muscles.', null, null, 'recovery', 'pebble-shore', 348),
  ('rec-039', 'Unwind your shoulders, loosen your hips, soften your jaw.', null, null, 'recovery', 'rest-bench', 349),
  ('rec-040', 'Recovery days protect the progress you’ve made.', null, null, 'recovery', 'pebble-shore', 350),
  ('rec-041', 'Sleep deep. Wake ready.', null, null, 'recovery', 'rest-bench', 351),
  ('rec-042', 'Take care of the body that carries you everywhere.', null, null, 'recovery', 'pebble-shore', 352),
  ('rec-043', 'Hydrate, stretch, rest. Simple, powerful, repeatable.', null, null, 'recovery', 'rest-bench', 353),
  ('rec-044', 'Healing takes the time it takes. Be patient.', null, null, 'recovery', 'pebble-shore', 354),
  ('rec-045', 'Come back from injury slowly. The goal is to stay back.', null, null, 'recovery', 'rest-bench', 355),
  ('rec-046', 'A good cool-down is the first step of the next session.', null, null, 'recovery', 'pebble-shore', 356),
  ('rec-047', 'Breathing slowly is recovery you can do anywhere.', null, null, 'recovery', 'rest-bench', 357),
  ('rec-048', 'Tired means rest a while, not stop for good.', null, null, 'recovery', 'pebble-shore', 358),
  ('rec-049', 'Mobility today means freedom tomorrow.', null, null, 'recovery', 'rest-bench', 359),
  ('rec-050', 'The off-season is where athletes quietly rebuild.', null, null, 'recovery', 'pebble-shore', 360),
  ('rec-051', 'Recovery is the respect you pay to the work you’ve done.', null, null, 'recovery', 'rest-bench', 361),
  ('rec-052', 'Let your heart rate fall, your breath slow and your mind follow.', null, null, 'recovery', 'pebble-shore', 362),
  ('rec-053', 'A lighter week now keeps you training for years.', null, null, 'recovery', 'rest-bench', 363),
  ('rec-054', 'Your muscles grow in the quiet hours.', null, null, 'recovery', 'pebble-shore', 364),
  ('rec-055', 'Ease off today so you can push again tomorrow.', null, null, 'recovery', 'rest-bench', 365),
  ('rec-056', 'Balance effort with rest and you’ll go further than you thought.', null, null, 'recovery', 'pebble-shore', 366),
  ('rec-057', 'An evening walk by the water does more than you’d think.', null, null, 'recovery', 'rest-bench', 367),
  ('rec-058', 'Restore, refuel, return.', null, null, 'recovery', 'pebble-shore', 368),
  ('rec-059', 'Rest is productive. Your body is busy repairing.', null, null, 'recovery', 'rest-bench', 369),
  ('rec-060', 'Kindness to your body includes knowing when to stop.', null, null, 'recovery', 'pebble-shore', 370),
  ('rec-061', 'Lie down, breathe deeply, let the day go.', null, null, 'recovery', 'rest-bench', 371),
  ('rec-062', 'Recovered athletes are confident athletes.', null, null, 'recovery', 'pebble-shore', 372)
on conflict (id) do update
  set text = excluded.text, author = excluded.author, source = excluded.source, theme = excluded.theme,
      scene = excluded.scene, position = excluded.position;

-- 2. Each member's history ---------------------------------------------------------------------------------

create table if not exists public.daily_quote_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  quote_id text not null references public.daily_quotes (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, local_date),
  constraint daily_quote_history_quote_key unique (user_id, quote_id)
);

alter table public.daily_quote_history enable row level security;
revoke all on table public.daily_quote_history from public, anon, authenticated;
grant select on table public.daily_quote_history to authenticated;

drop policy if exists daily_quote_history_owner_read on public.daily_quote_history;
create policy daily_quote_history_owner_read on public.daily_quote_history for select to authenticated
  using (user_id = (select auth.uid()));

comment on table public.daily_quote_history is
  'The quote each member saw on each local day, so a quote never repeats; written only by fitx_daily_quote (20261123100010).';

-- The write budget (20261121100040) counts these rows too, when that migration is there.
do $do$
begin
  if pg_catalog.to_regprocedure('public.fitx_member_write_budget()') is not null then
    execute 'create or replace trigger fitx_write_budget_insert after insert on public.daily_quote_history '
      'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()';
    execute 'create or replace trigger fitx_write_budget_update after update on public.daily_quote_history '
      'referencing new table as new_rows for each statement execute function public.fitx_member_write_budget()';
  end if;
end $do$;

-- 3. The day's quote ---------------------------------------------------------------------------------------

-- The signed-in member's quote for p_local_date (their own calendar day, within two days of today in UTC, so
-- the library cannot be used up ahead of time). p_avoid: quotes this browser showed before this migration,
-- avoided while others remain. Returns one row; raises 28000 when no one is signed in, 22023 for a day too
-- far from today.
create or replace function public.fitx_daily_quote(p_local_date date, p_avoid text[] default '{}')
returns table (quote_id text, local_date date, text text, author text, source text, theme text, scene text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_today date := (pg_catalog.now() at time zone 'utc')::date;
  v_avoid text[] := coalesce(p_avoid[1:800], '{}');
  v_pick text;
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'sign in to see your quote';
  end if;
  if p_local_date is null or p_local_date < v_today - 2 or p_local_date > v_today + 2 then
    raise exception using errcode = '22023', message = 'that day is too far from today';
  end if;

  loop
    v_attempt := v_attempt + 1;
    -- Already picked for this day: the same quote.
    select h.quote_id into v_pick from public.daily_quote_history h where h.user_id = v_uid and h.local_date = p_local_date;
    exit when v_pick is not null;

    -- The next unseen quote, else the one seen longest ago.
    select q.id into v_pick
    from public.daily_quotes q
    left join public.daily_quote_history h on h.user_id = v_uid and h.quote_id = q.id
    order by (h.local_date is not null), h.local_date nulls first, (q.id = any (v_avoid)),
      pg_catalog.md5(v_uid::text || ':' || p_local_date::text || ':' || q.id)
    limit 1;
    if v_pick is null then
      return; -- an empty library
    end if;

    -- A quote shown before moves to the new day; a second tab picking at the same moment wins or loses cleanly.
    delete from public.daily_quote_history h where h.user_id = v_uid and h.quote_id = v_pick and h.local_date <> p_local_date;
    insert into public.daily_quote_history (user_id, local_date, quote_id) values (v_uid, p_local_date, v_pick)
      on conflict do nothing;
    v_pick := null;
    exit when v_attempt >= 3;
  end loop;

  return query
    select q.id, h.local_date, q.text, q.author, q.source, q.theme, q.scene
    from public.daily_quote_history h
    join public.daily_quotes q on q.id = h.quote_id
    where h.user_id = v_uid and h.local_date = p_local_date;
end $function$;

revoke all on function public.fitx_daily_quote(date, text[]) from public, anon, authenticated;
grant execute on function public.fitx_daily_quote(date, text[]) to authenticated;

comment on function public.fitx_daily_quote(date, text[]) is
  'The signed-in member''s quote for their local day: the same all day, never one they saw before while unseen ones remain (20261123100010).';
