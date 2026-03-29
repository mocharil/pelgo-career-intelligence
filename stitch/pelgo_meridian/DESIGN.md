# Design System Strategy: The Career Architect

## 1. Overview & Creative North Star
The North Star for this design system is **"The Digital Architect."** 

In career intelligence, users are often overwhelmed by noise. Our goal is to move beyond the generic "SaaS Dashboard" and create a space that feels like a high-end editorial publication mixed with a precision engineering tool. We achieve this through **Intentional Asymmetry** and **Tonal Depth**. By breaking the rigid, boxed-in grid of traditional platforms, we guide the user’s eye through career data using whitespace as a structural element rather than a void. The experience should feel authoritative yet breathable—trustworthy enough for a career pivot, yet modern enough for a tech-forward professional.

---

## 2. Colors & Surface Architecture
This system utilizes a sophisticated palette of Deep Indigos (`primary`) and Crisp Whites (`surface`), accented by "Growth Greens" (`tertiary`).

### The "No-Line" Rule
To maintain a premium, editorial feel, **1px solid borders are prohibited for sectioning.** Boundaries must be defined solely through background color shifts or subtle tonal transitions. For example, a `surface-container-low` sidebar sitting against a `surface` background provides all the definition needed without the "clutter" of a stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of frosted glass.
- **Base Layer:** `surface` (#fbf8ff)
- **Content Sections:** `surface-container-low` (#f4f2ff)
- **Active Cards:** `surface-container-lowest` (#ffffff) for maximum "lift."
- **Interactive Insets:** `surface-container-high` (#e7e6ff) for nested data fields or search bars.

### The "Glass & Gradient" Rule
To add "soul" to the data:
- **Glassmorphism:** Use `surface-variant` at 60% opacity with a `backdrop-blur` of 12px for floating navigation bars or modal overlays.
- **Signature Gradients:** For primary CTAs and Hero backgrounds, use a subtle linear gradient transitioning from `primary` (#050728) to `primary_container` (#1c1f3f) at a 135-degree angle. This prevents the "flat" look of standard SaaS components.

---

## 3. Typography
We utilize **Inter** (as the primary readable workhorse) and **Geist** (for high-end display moments) to convey a sense of precision.

*   **Display (lg/md):** Reserved for high-impact career milestones or landing headers. Tight tracking (-2%) to feel authoritative.
*   **Headline (sm/md):** Used for dashboard section titles. These should never be crowded; give them 24px–32px of bottom margin (`spacing-6` to `spacing-8`).
*   **Body (md/lg):** The engine of the platform. Use `on-surface-variant` (#46464e) for secondary body text to reduce visual vibration against the crisp white backgrounds.
*   **Label (sm/md):** Monospace-adjacent styling for data points (e.g., "MATCH SCORE: 98%").

---

## 4. Elevation & Depth
Hierarchy is achieved through **Tonal Layering** rather than drop shadows.

*   **The Layering Principle:** Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a soft, natural lift that mimics fine paper stocks.
*   **Ambient Shadows:** If a "floating" element (like a floating action button or dropdown) requires a shadow, use a blur of 32px with 6% opacity, tinted with `primary` (#050728). Never use pure black shadows.
*   **The "Ghost Border":** If accessibility requires a container edge, use `outline-variant` (#c7c5cf) at 20% opacity. If you can see the border clearly, it is too heavy.
*   **Progress Indicators:** Use `tertiary_fixed` (#6ffbbe) for growth metrics. It should feel like a glowing "signal" of progress against the deep indigo backgrounds.

---

## 5. Components

### Buttons
*   **Primary:** Gradient-filled (`primary` to `primary_container`) with `on-primary` text. No border. Large horizontal padding (`spacing-6`).
*   **Secondary:** `surface-container-highest` background with `primary` text. Soft, tonal, and integrated.
*   **Tertiary:** No background. Underlined only on hover, or paired with a small chevron.

### Cards & Lists (Data Rich)
*   **The Divider Forbid:** Never use a horizontal line to separate list items. Use 16px of vertical white space (`spacing-4`) and a subtle `surface-container-low` hover state to indicate rows.
*   **Status Indicators:** Small, pill-shaped chips using `tertiary_container` (background) and `on-tertiary-container` (text) for "Growth" or "Matched" states.

### Career-Specific Components
*   **The "Growth Bar":** A progress bar using `primary_container` as the track and `tertiary_fixed_dim` as the fill. Add a subtle outer glow to the fill to symbolize "energy" or "potential."
*   **Insight Insets:** Use `surface-container-highest` for "Career Intelligence" tips—small, nested boxes that provide contextual advice without breaking the page flow.

---

## 6. Do's and Don'ts

### Do:
*   **Use Asymmetry:** Align a headline to the left and a CTA slightly offset to the right to create a modern, editorial rhythm.
*   **Embrace Whitespace:** If a screen feels cluttered, increase the spacing from `spacing-4` to `spacing-10`. Career data needs room to breathe.
*   **Layer Surfaces:** Always ask: "Can I define this area with a background color shift instead of a line?"

### Don't:
*   **Don't Use Pure Black:** Use `primary` (#050728) or `on-surface` (#161838) for text to maintain a high-end, "ink" look rather than a "computer" look.
*   **Don't Use Sharp Corners:** Adhere strictly to the `rounded-lg` (0.5rem) scale for cards and `rounded-full` for chips to keep the platform feeling approachable.
*   **Don't Over-Iconize:** Use icons sparingly. Typography should do the heavy lifting. Icons should be thin-stroke (1.5px) and monochromatic.