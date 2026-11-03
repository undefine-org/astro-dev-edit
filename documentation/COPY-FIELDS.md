# Copy fields

The launcher menu's Copy fields drawer searches explicit shared-source bindings,
static placeholders, titles, alternative text and accessible labels, and hidden
messages present in the current page's DOM. Hidden messages open in a popup;
there is no need to submit a form to reveal and edit their text.

Attributes are patched at their original Astro source location and participate
in persistent history. Only quoted copy attributes are accepted; computed props,
event handlers and arbitrary attribute names are refused. Shared and derived
fields use the explicit binding documented in BINDINGS.md.

Form submissions are suppressed while edit mode is active. Leave edit mode to
use a real form. This keeps testing copy separate from sending a signup or order.
