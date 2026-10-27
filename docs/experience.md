# Everyday viewing experience

This extension follows [PRODUCT.md](../PRODUCT.md): Android is the primary surface, with web as a companion. Matinee's name, assets, themes, Material 3 components, logging, recommendations, statistics, Bookmarks and Seen remain in place. It extends the existing visual system; it establishes no replacement tokens or visual identity.

## Navigation and daily tasks

- The four destinations remain Discover, Upcoming, Stats and Library (`app/(tabs)/_layout.tsx`). `AdaptiveNavigation` retains bottom navigation on compact windows and a side rail on wider windows. The recommendation FAB remains available across tabs.
- Discover opens with search and media/genre controls, then Recommended for you and the familiar trending, recently watched, popular and top-rated rails. There are no subscription, provider or Continue Watching blocks in the feed. The existing recommendation FAB is the only picker entry point. Mood, media type and duration are upfront; pacing, genres and era are behind More preferences. It opens Pick for tonight and works through the local/TMDB fallback even without a Gemini key. Results retain movie/series identity when opening details.
- Poster cards contain artwork, title, release information and relevant ratings/context. There are no repeated bookmark/log/action rows beneath every poster. Tap opens details; long press opens quick actions.

## Library and detail behavior

Bookmarks and Seen are the only top-level Library sections. The compact toolbar keeps All, Movies and Series filters, a search toggle and Library tools. The search field appears only when requested. Library tools contains sorting, collections, Watching, Diary and Hidden. Long press opens title actions; multi-selection and collection assignment start from that menu, and bulk actions appear only during selection. Removal still offers Undo, including saved ratings and episode logs.

The title detail screen keeps Watched, Watchlist and Rate upfront. Episode progress is opened explicitly from More instead of duplicating the existing episode logging controls on every visit. A small play icon overlays the poster only when a valid external streaming listing or trailer is available. It opens regional options (or the trailer); it does not play video inside Matinee or promise direct playback. Provider logos, subscription/rent/buy sections and streaming marketing copy are absent from the main screen. The single More action contains tracking, diary/rewatch, soundtrack and recommendation-feedback tools.

Stats opens directly onto its existing metrics and charts, without a separate recap banner. Episode progress remains independent of ratings. Existing stats, diary records, tracking, collections, hidden suggestions and sync semantics are preserved. Diary month/year recaps count explicitly logged viewings separately from Seen statistics, and runtime totals use known film runtimes. The simplification changes where secondary actions live, not the stored records or data model.

## Data and compatibility

Title identity includes media type and TMDB ID. Bookmark, watching, collection membership, diary, feedback and episode activity extend the existing SQLite library. A bookmark can coexist with a Seen entry and its rating. Additive migrations retain existing records and migrate legacy rated episodes into progress without requiring future episode ratings. Version 1 backups remain readable; current backups include activity, and restore is transactional.

Changes save locally, with durable pending sync writes and deletion boundaries. Account setup, deployment requirements and migration guidance are in [Account sync rollout](account-sync.md). No remote configuration or publication is part of this local extension. See [README: Everyday viewing tools and regression checks](../README.md#everyday-viewing-tools) for operation and test commands.

## Existing visual evidence

`constants/m3/tokens.ts` remains authoritative for typography, shape, spacing, elevation, motion and touch-target helpers. It supplies Android sans-serif/medium families, Material display through label roles, a 4dp spacing rhythm, shapes from square through full rounding, density settings and a 48dp minimum touch target. `constants/m3/scheme.ts` retains semantic accent/on-accent and surface/on-surface roles, light surfaces and the existing OLED-black dark surface ladder. Do not duplicate or redefine those values here.

`context/ThemeContext.tsx` retains light, dark and system preference, OS appearance following, reduced-motion state and compatibility aliases derived from semantic roles. The new `components/library/*` surfaces reuse the existing M3 `Button`, `Chip`, `Text`, fields, `IconButton`, `ListItem`, `BottomSheet` and loading states, alongside `MovieCard`, `CarouselSection` and `EmptyState`. These components and the incumbent native Android conventions are the implementation reference for future extensions; this document is a behavior handoff, not a visual redesign specification.

## Verification and limits

The implementation handoff reports 20 passing regression checks against the real SQLite services, a passing TypeScript check, and successful final web and Android exports. Final review resolved four material issues and assessed this scope as ready to ship. Export success validates bundle generation, not native runtime behavior.

Native visual/device QA remains unverified: sandbox socket denial prevented launching the required local surface, and `adb devices -l` could not install its smartsocket listener (“Operation not permitted”). Screenshots were unavailable. No web design detector was run because the primary application is native React Native. Device validation is still needed for visual layout, interaction/accessibility, notifications, SecureStore, account authentication against the deployed Firebase project and sharing. The SQLite checks use offline adapters and do not validate deployed cloud configuration; see the linked rollout and README for those boundaries.
