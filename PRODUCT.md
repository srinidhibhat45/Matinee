# Matinee

<!-- impeccable:product-schema 1 -->

## Platform

android

## Product Purpose

Track movies and series, choose what to watch, and understand personal viewing habits.

## Capabilities and Constraints

Preserve easy movie logging, recommendations, statistics, bookmarks/watchlist, and watched/seen pages. Extend the existing Expo / React Native app and Material 3 components. Existing SQLite records and version 1 backups must remain readable. Web is supported as a companion surface. Do not publish updates or change remote services as part of local implementation.

## Primary Device

Samsung Galaxy S24 Ultra. Preserve the earlier compact phone UI, using the current window size rather than physical screen pixels. Keep the three-column poster grid, two-column Stats cards, safe-area spacing, readable text and 48dp touch targets. Secondary tools must not displace primary tasks.

## Product Principles

- Keep the interface clean and upfront: logging, recommendations, bookmarks, Seen and Stats take priority. Matinee is a tracker, not a streaming browser.
- Logging and bookmarking remain directly accessible.
- Streaming is an optional play icon on title artwork; do not add provider logos, subscription rails or repeated per-poster action rows.
- The recommendation picker opens only from the existing FAB; do not duplicate it in the home feed.
- Secondary tools belong behind menus rather than expanding the main screens.
- Episode progress never requires a rating.
- Availability is specific to the selected country.
- Offline changes remain local and retry when syncing.
- Recommendations explain their relevance and accept feedback.

## Brand Commitments

Preserve Matinee's name, assets, themes, and existing Material 3 identity.
