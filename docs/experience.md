# Everyday viewing experience

This extension follows [PRODUCT.md](../PRODUCT.md): Android is the primary surface, with web as a companion. Matinee's name, assets, themes, Material 3 components, logging, recommendations, statistics, Bookmarks and Seen remain in place. It extends the existing visual system; it establishes no replacement tokens or visual identity.

## Navigation and daily tasks

- The four destinations remain Discover, Upcoming, Stats and Library (`app/(tabs)/_layout.tsx`). `AdaptiveNavigation` retains bottom navigation on compact windows and a side rail on wider windows. The recommendation FAB remains available across tabs.
- Discover adds an inline, initially collapsed Tonight picker. Mood, runtime, preferred languages and optional subscription filters request up to three picks. Changing filters clears the previous result; loading, retryable error and no-match states are explicit. Results use existing poster cards and open the existing detail route with recommendation context.
- Continue Watching uses explicit tracking and episode activity, and opens title details. It is viewing progress, not video playback or a promise of playback resume.
- The subscription check runs only on demand, checking up to the 12 most recently added released bookmarks against selected subscriptions. It asks users without subscriptions to configure them in Library Settings. An empty result means no confirmed match in that checked subset, not that the entire library is unavailable.
- Poster quick actions keep bookmarking and the logging form directly accessible. Future titles can be bookmarked; their logging action is withheld until release.

## Library and detail behavior

Library keeps Bookmarks and Seen first, followed by Watching, Diary and Hidden. Poster sections support title search, movie/series filters and sorting by recent addition, title, personal rating, runtime or release. Unknown runtimes sort after known runtimes. Collections filter these sections without changing viewing status; deleting a collection keeps its titles. Holding a stored poster enters multi-selection for marking seen, adding to collections or removal. Per-title actions remain available. Removal offers Undo, restoring saved ratings and episode history.

Diary has its own month/year view and recap sharing. A viewing or rewatch has a date and optional note; its rating is optional. Diary totals count explicitly logged viewings, while existing Seen statistics retain their original meaning. Recap runtime totals use known film runtimes and should not be read as complete series watch time. Hidden includes legacy not-interested titles and hidden recommendation feedback; a per-title action makes suggestions eligible again.

Details retain the existing title/logging flow and add viewing/rewatch notes, explicit watching tracking and recommendation feedback. “Not tonight” pauses a suggestion for 24 hours; hide persists until cleared. Episode progress is independent of rating: choose a season, mark individual released episodes, or mark its released episodes together. Future and unknown-air-date episodes cannot be marked through this UI. Loading errors have a retry action; next-episode guidance is scoped to the selected season.

Streaming availability is specific to the selected country (`services/tmdb.ts`, `components/library/StreamingAvailability.tsx`). Subscription inclusion, rental and purchase appear separately, with selected subscriptions identified. Missing regional listings remain unknown; another country's providers are never substituted. The external provider-options action opens the regional listing, not guaranteed direct playback. TMDB / JustWatch data can change.

## Data and compatibility

Title identity includes media type and TMDB ID. Bookmark, watching, collection membership, diary, feedback and episode activity extend the existing SQLite library. A bookmark can coexist with a Seen entry and its rating. Additive migrations retain existing records and migrate legacy rated episodes into progress without requiring future episode ratings. Version 1 backups remain readable; current backups include activity, and restore is transactional.

Changes save locally, with durable pending sync writes and deletion boundaries. Account setup, deployment requirements and migration guidance are in [Account sync rollout](account-sync.md). No remote configuration or publication is part of this local extension. See [README: Everyday viewing tools and regression checks](../README.md#everyday-viewing-tools) for operation and test commands.

## Existing visual evidence

`constants/m3/tokens.ts` remains authoritative for typography, shape, spacing, elevation, motion and touch-target helpers. It supplies Android sans-serif/medium families, Material display through label roles, a 4dp spacing rhythm, shapes from square through full rounding, density settings and a 48dp minimum touch target. `constants/m3/scheme.ts` retains semantic accent/on-accent and surface/on-surface roles, light surfaces and the existing OLED-black dark surface ladder. Do not duplicate or redefine those values here.

`context/ThemeContext.tsx` retains light, dark and system preference, OS appearance following, reduced-motion state and compatibility aliases derived from semantic roles. The new `components/library/*` surfaces reuse the existing M3 `Button`, `Chip`, `Text`, fields, `IconButton`, `ListItem`, `BottomSheet` and loading states, alongside `MovieCard`, `CarouselSection` and `EmptyState`. These components and the incumbent native Android conventions are the implementation reference for future extensions; this document is a behavior handoff, not a visual redesign specification.

## Verification and limits

The implementation handoff reports 20 passing regression checks against the real SQLite services, a passing TypeScript check, and successful final web and Android exports. Final review resolved four material issues and assessed this scope as ready to ship. Export success validates bundle generation, not native runtime behavior.

Native visual/device QA remains unverified: sandbox socket denial prevented launching the required local surface, and `adb devices -l` could not install its smartsocket listener (“Operation not permitted”). Screenshots were unavailable. No web design detector was run because the primary application is native React Native. Device validation is still needed for visual layout, interaction/accessibility, notifications, SecureStore, account authentication against the deployed Firebase project and sharing. The SQLite checks use offline adapters and do not validate deployed cloud configuration; see the linked rollout and README for those boundaries.
