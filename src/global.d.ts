/**
 * ControlDesk — global TypeScript augmentations.
 *
 * next-intl module augmentation gives us autocomplete + compile-time
 * validation on every translation key. If a key exists in the id.json but
 * not en.json (or vice-versa), TypeScript will complain.
 *
 * The `IntlMessages` type is derived from the Indonesian dictionary since
 * that is the default locale (rules §18). Both files must stay structurally
 * in sync.
 */

import type messages from "../messages/id.json";

type Messages = typeof messages;

declare module "next-intl" {
  interface AppConfig {
    Messages: Messages;
  }
}

export {};
