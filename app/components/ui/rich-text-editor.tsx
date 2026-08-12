/**
 * The note editor — a Tiptap surface that posts like a `<textarea>`.
 *
 * A consultation note is written under time pressure and read back by someone
 * else, so the formatting on offer is deliberately short: emphasis, lists,
 * and two heading levels. There is no link, no image, no colour — nothing that
 * carries a URL, which is also what lets the read view sanitise by stripping
 * every attribute (see `~/lib/rich-text`).
 *
 * The editor keeps the plain-form submission the routes are built on: the HTML
 * rides in a hidden input under the given `name`, so `request.formData()` reads
 * it exactly as it read the textarea before. Nothing about the action changes
 * beyond the value now being markup.
 */

import { useEffect, useState } from "react";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  HeadingIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  RedoIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UndoIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { toEditorHtml } from "~/lib/rich-text";

/**
 * How note markup renders, in the editor and in the read view alike.
 *
 * One declaration for both so a note cannot look like one thing while it is
 * being written and another once it is signed.
 */
const proseClass = cn(
  "text-sm leading-relaxed",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:tracking-wide [&_h4]:uppercase [&_h4]:text-muted-foreground",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs",
  "[&_hr]:my-3 [&_hr]:border-t",
  "[&_strong]:font-semibold [&_u]:underline [&_s]:line-through",
);

/**
 * A note's markup, rendered read-only.
 *
 * Takes either shape a stored field can be in: HTML is sanitised, plain text
 * from before the editor existed is escaped and paragraphed. Both go through
 * `toEditorHtml`, so what is read back matches what an amendment would open.
 */
export function RichText({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(proseClass, className)}
      dangerouslySetInnerHTML={{ __html: toEditorHtml(html) }}
    />
  );
}

/* -------------------------------------------------------------------------
   Toolbar
   ------------------------------------------------------------------------- */

function ToolbarButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Toolbars steal focus from the text otherwise, and a formatting button
      // that drops the selection formats nothing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-accent-foreground",
        "[&_svg]:size-3.5",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />;
}

/* -------------------------------------------------------------------------
   The editor
   ------------------------------------------------------------------------- */

export type RichTextEditorProps = {
  /**
   * The form field the HTML is posted under. Omit when the parent already
   * posts the value itself — the picker's repeating rows do.
   */
  name?: string;
  /** Goes on the editable surface, so a `<FieldLabel htmlFor>` still points at it. */
  id?: string;
  /** Plain text or HTML — an older note is promoted to paragraphs on the way in. */
  defaultValue?: string;
  /** Called with the HTML on every edit, for callers keeping their own state. */
  onChange?: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Roughly how tall the writing area starts out. */
  minRows?: number;
  className?: string;
};

export function RichTextEditor({
  name,
  id,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  invalid,
  minRows = 3,
  className,
}: RichTextEditorProps) {
  // Read once: the editor owns its content after mount, and re-seeding it on a
  // parent re-render would fight the cursor.
  const [initialHtml] = useState(() => toEditorHtml(defaultValue));
  // The posted value. Seeded so a submit that happens before Tiptap has
  // hydrated still carries what the note already said.
  const [html, setHtml] = useState(initialHtml);

  const editor = useEditor({
    // Tiptap cannot render on the server; without this the first paint throws.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // No links: the sanitiser drops every attribute, so an `href` written
        // here would silently not survive being read back.
        link: false,
        heading: { levels: [3, 4] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: initialHtml,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const next = editor.isEmpty ? "" : editor.getHTML();
      setHtml(next);
      onChange?.(next);
    },
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        role: "textbox",
        "aria-multiline": "true",
        "aria-invalid": invalid ? "true" : "false",
        class: cn(
          proseClass,
          "w-full px-2.5 py-2 outline-none",
          "[&_p.is-editor-empty:first-child]:before:pointer-events-none",
          "[&_p.is-editor-empty:first-child]:before:float-left",
          "[&_p.is-editor-empty:first-child]:before:h-0",
          "[&_p.is-editor-empty:first-child]:before:text-muted-foreground",
          "[&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
        ),
        style: `min-height: ${minRows * 1.625 + 1}rem`,
      },
    },
  });

  // `editable` is fixed at creation, so a form going busy has to say so.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            underline: editor.isActive("underline"),
            strike: editor.isActive("strike"),
            heading: editor.isActive("heading", { level: 3 }),
            bulletList: editor.isActive("bulletList"),
            orderedList: editor.isActive("orderedList"),
            blockquote: editor.isActive("blockquote"),
            canUndo: editor.can().undo(),
            canRedo: editor.can().redo(),
          }
        : undefined,
  });

  const chain = () => editor?.chain().focus();

  return (
    <div
      data-slot="rich-text-editor"
      className={cn(
        "w-full overflow-hidden rounded-lg border border-input bg-transparent transition-colors dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        invalid &&
          "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
        disabled && "cursor-not-allowed bg-input/50 opacity-50 dark:bg-input/80",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
        <ToolbarButton
          label="Bold"
          active={state?.bold}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleBold().run()}
        >
          <BoldIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={state?.italic}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleItalic().run()}
        >
          <ItalicIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={state?.underline}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleUnderline().run()}
        >
          <UnderlineIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={state?.strike}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleStrike().run()}
        >
          <StrikethroughIcon />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          label="Subheading"
          active={state?.heading}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleHeading({ level: 3 }).run()}
        >
          <HeadingIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Bulleted list"
          active={state?.bulletList}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleBulletList().run()}
        >
          <ListIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={state?.orderedList}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleOrderedList().run()}
        >
          <ListOrderedIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          active={state?.blockquote}
          disabled={disabled || !editor}
          onClick={() => chain()?.toggleBlockquote().run()}
        >
          <QuoteIcon />
        </ToolbarButton>

        <Divider />

        <ToolbarButton
          label="Undo"
          disabled={disabled || !state?.canUndo}
          onClick={() => chain()?.undo().run()}
        >
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Redo"
          disabled={disabled || !state?.canRedo}
          onClick={() => chain()?.redo().run()}
        >
          <RedoIcon />
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} className="max-h-112 overflow-y-auto" />

      {/* What the action actually reads. */}
      {name && <input type="hidden" name={name} value={html} />}
    </div>
  );
}
