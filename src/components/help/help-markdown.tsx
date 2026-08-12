/* Client-side wrapper around `react-markdown`.
 *
 * Plugins are imported and configured HERE, not passed in from the
 * caller. Reason: the RSC → client boundary only serialises plain
 * data (primitives, plain objects, arrays of those, and Server
 * Actions). Function references — which every remark/rehype plugin
 * is — cannot cross that boundary. Passing them as props from a
 * Server Component page threw at request time:
 *
 *   Error: Functions cannot be passed directly to Client Components
 *   unless you explicitly expose it by marking it with "use server".
 *
 * Baking the plugin list into this file also keeps the rendering
 * pipeline centralised — every `/help/{slug}` page renders with the
 * same GFM + slug + autolink behaviour, which is what reviewers
 * expect anyway.
 */
"use client";

import ReactMarkdown from "react-markdown";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

type HelpMarkdownProps = {
  markdown: string;
};

// Constants (not props) so React can safely reuse them across renders
// without prop-identity churn.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [
  rehypeSlug,
  [rehypeAutolinkHeadings, { behavior: "wrap" }],
];

export function HelpMarkdown({ markdown }: HelpMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{
        // External links open in a new tab; internal/anchor links
        // stay in-app so client-side navigation still works.
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
