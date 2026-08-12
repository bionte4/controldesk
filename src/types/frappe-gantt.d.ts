/**
 * Ambient type declarations for `frappe-gantt` (v1.2.2). The package ships
 * plain JavaScript, so we mirror the runtime API for TypeScript consumers.
 * Kept intentionally narrow — only the fields we use in
 * `src/app/(app)/projects/[id]/tasks/gantt-chart.tsx`.
 */

declare module "frappe-gantt" {
  export type FrappeGanttTask = {
    id: string;
    name: string;
    start: string; // 'YYYY-MM-DD'
    end: string; // 'YYYY-MM-DD'
    progress: number; // 0-100
    dependencies?: string; // comma-separated ids
    custom_class?: string;
  };

  export type FrappeGanttViewMode =
    | "Quarter Day"
    | "Half Day"
    | "Day"
    | "Week"
    | "Month"
    | "Year";

  export type FrappeGanttOptions = {
    view_mode?: FrappeGanttViewMode | string;
    date_format?: string;
    today_color?: string;
    popup_trigger?: "click" | "mouseover" | "none";
    readonly?: boolean;
    header_height?: number;
    bar_height?: number;
    bar_corner_radius?: number;
    arrow_curve?: number;
    padding?: number;
    on_click?: (task: FrappeGanttTask) => void;
    on_date_change?: (
      task: FrappeGanttTask,
      start: Date,
      end: Date,
    ) => void;
    on_progress_change?: (task: FrappeGanttTask, progress: number) => void;
    on_view_change?: (mode: string) => void;
    custom_popup_html?: (task: FrappeGanttTask) => string;
  };

  export default class Gantt {
    constructor(
      wrapper: string | HTMLElement | SVGElement,
      tasks: FrappeGanttTask[],
      options?: FrappeGanttOptions,
    );
    refresh(tasks: FrappeGanttTask[]): void;
    change_view_mode(mode: FrappeGanttViewMode | string): void;
  }
}

declare module "frappe-gantt/dist/frappe-gantt.css" {
  const content: string;
  export default content;
}
