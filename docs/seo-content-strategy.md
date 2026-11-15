# FITX public search and brand strategy

FITX should earn search visibility by publishing useful, accurate fitness resources and making the public site easy to crawl. Rankings are not guaranteed; measure progress from Google Search Console and improve the experience over time.

## Brand system

- Use **FITX** consistently, with the tagline **TRAIN SMART. LIVE FIT.**
- Keep the geometric mark and typeset FITX wordmark as separate assets.
- Use the warm light palette as the default, the monochrome mark in both themes, and the oxide accent for key actions.
- Use original photography or assets with documented permission. Keep descriptions factual and avoid invented product capabilities.

## Public page plan

Build a small set of useful, maintained pages as the product and reviewed content are ready:

| Topic | Useful public resource | Quality requirement |
| --- | --- | --- |
| Workout planning | Goal, schedule, and equipment-aware planning guide | Make limitations and sample plans clear; include a qualified review for safety claims |
| Exercise demonstrations | One page per supported movement with setup, steps, target muscles, equipment, and accessible visual instructions | Verify movement details; show original demonstrations; link alternatives |
| Indian food and nutrition | Food pages and practical logging guidance, including regional naming where data supports it | Show the source and date of nutrition data; advise users to check packaging for allergies |
| Calorie tracking | Explain estimates, portions, and what the tracker can and cannot infer | Avoid medical or weight-loss promises; cite reputable evidence for health claims |
| Walking, running, and cycling | Activity guides and tracking instructions when those features are implemented | Do not imply GPS or route recording exists until the feature ships |
| Fitness progress | Explain how recorded workouts and measurements are summarized | Keep private account data out of public examples and page output |

Publish only when a page answers a distinct user need. Do not create near-duplicate landing pages for keyword variants or use automated pages without meaningful review.

## Editorial and trust process

1. Write for the question a person is trying to answer, then select a descriptive, stable URL.
2. Cite primary research, government health guidance, or recognized professional organizations for factual health claims. State uncertainty where evidence is limited.
3. Have an appropriately qualified reviewer check exercise safety and nutrition or health claims before publication. Display reviewer role and review date only when confirmed.
4. Maintain author, source, last-reviewed date, image rights, and correction records for every health resource.
5. Keep product pages aligned with shipped capabilities. Never fabricate testimonials, ratings, clinical outcomes, business locations, or credentials.

## Technical publishing checklist

- Server-render the main text, headings, and descriptive links.
- Give every indexable page one canonical URL, unique title and description, social metadata, and one clear `h1`.
- Link related guides with normal crawlable anchors. Use descriptive image alternatives and responsive, compressed media.
- Add only structured data that matches visible, factual page content. Use article or recipe types only when the page meets their actual requirements.
- Include only canonical public URLs in `sitemap.xml`; keep account, onboarding, and API routes private and out of the index.
- Check redirects, mobile layout, accessibility, Core Web Vitals, and rendered metadata before publishing.

## Measurement

After domain ownership is verified, connect Google Search Console and submit the sitemap. Review indexing and crawl issues, search impressions, clicks, click-through rate, and query/page visibility monthly. Compare non-branded and branded discovery, and prioritize fixes that improve useful visits rather than chasing a position target. Connect analytics only with the configured consent choice and an approved account.

Official starting point: [Google Search Central SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).
