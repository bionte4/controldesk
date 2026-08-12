/* Client-side wrapper around `react-markdown` — the library needs
 * React 19 client components for its internal Suspense boundaries.
 *
 * We accept the plugin arrays as props from the RSC page rather than
 * hard-coding them here so the choice of remark/rehype plugins lives
 * next to the article route (where reviewers expect it). The
 * `unknown[]` typing shape is intentional — remark/rehype's Options
 * typings vary across plugins and forcing a stricter type here means
 * more `as` casts at every call site.
 */
"use client";

import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";

// `react-markdown` re-exports `Options` from `unified`, but `unified`
// itself isn't a direct dependency of this project so its type
// declarations aren't resolvable from `.pnpm`. Pull the plugin-list
// type out of `ReactMarkdown`'s own props instead — same underlying
// `PluggableList` type, but only via a package we do depend on.
type PluginList = ComponentProps<typeof ReactMarkdown>["remarkPlugins"];

type HelpMarkdownProps = {
  markdown: string;
  remarkPlugins?: PluginList;
  rehypePlugins?: PluginList;
};

export function HelpMarkdown({
  markdown,
  remarkPlugins,
  rehypePlugins,
}: HelpMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        // External links open in new tab; internal links stay in-app.
        // `href` starting with `/` is same-origin; anchors (`#…`)
        // scroll within the same article.
        a: ({ href, children, ...rest }) => {
          if (!href) return <a {...rest}>{children}</a>;
          const external = /^https?:\/\//.test(href);
          if (external) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...rest}
              >
                {children}
              </a>
            );
          }
          return (
            <a href={href} {...rest}>
              {children}
            </a>
          );
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
