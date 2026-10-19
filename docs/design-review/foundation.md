# Foundation design review

Review scope: owner setup/sign-in; Workflows, Executions, Credentials, Insights, Users, Projects and Settings at 1440, 1024, 768 and 390 px; editor at the same widths; create, node configuration and successful execution dialogs. Playwright creates captures in artifacts/visual. Initial empty pages and later populated reruns were inspected as contact sheets and selected full-size captures.

Issues corrected during review:

- Collapsed navigation lacked icon button names; added explicit labels and native tooltips.
- Mobile search lost its name when text was hidden; gave it an accessible name matching the visible label.
- Password helper text polluted the field name; set a stable field name.
- Success/warning colors in the source brief missed AA for 12px text on soft backgrounds; darkened semantic text tokens and added contrast regression tests.
- Viewport changes retained desktop canvas zoom; refit the graph after resize and enforced mobile read-only behavior in state.
- Screenshots caught a closing navigation transition; final captures disable finite animations.
- Added self-hosted variable fonts and split vendor bundles.

The complete master-spec UI gate remains open: the full primitive library, all advanced product pages and every loading/error/modal state across every breakpoint have not shipped. The current foundation E2E and axe audit do not establish full WCAG compliance. These are explicit release limitations, not accepted completion of the master spec.
