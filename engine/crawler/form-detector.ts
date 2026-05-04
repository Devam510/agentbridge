/**
 * form-detector.ts
 * Finds and maps all forms on a page — inputs, labels, submit buttons.
 * WHY: Forms are the primary action mechanism in human software.
 * We need to understand every form to generate agent-callable tools.
 */

import { Page } from 'playwright';

export interface FormField {
  name: string;
  label: string;
  type: string; // text, email, password, number, select, textarea, checkbox, radio
  placeholder: string;
  required: boolean;
  options?: string[]; // for select/radio
}

export interface DetectedForm {
  id: string; // unique id for this form
  action: string; // form action URL or '' if none
  method: string; // GET or POST
  purpose: string; // inferred purpose: 'login', 'search', 'create', 'filter', 'contact', etc.
  fields: FormField[];
  submitButtonText: string;
}

/**
 * Detect all forms on a page and extract their structure.
 * Does not submit or interact with forms — read-only analysis.
 */
export async function detectForms(page: Page): Promise<DetectedForm[]> {
  const forms = await page.evaluate((): DetectedForm[] => {
    const formElements = Array.from(document.querySelectorAll('form'));

    return formElements
      .map((form, index) => {
        const fields: FormField[] = [];

        const inputs = Array.from(
          form.querySelectorAll('input, select, textarea'),
        ) as HTMLInputElement[];

        for (const input of inputs) {
          // Skip hidden and submit inputs
          if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') {
            continue;
          }

          // Find associated label
          const labelEl =
            input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
          const label =
            labelEl?.textContent?.trim() ??
            input.getAttribute('aria-label') ??
            input.getAttribute('placeholder') ??
            input.name ??
            '';

          // Get options for select elements
          let options: string[] | undefined;
          if (input.tagName === 'SELECT') {
            options = Array.from((input as unknown as HTMLSelectElement).options).map(
              (o) => o.text,
            );
          }

          fields.push({
            name: input.name || input.id || `field_${fields.length}`,
            label: label.slice(0, 100),
            type: input.type || input.tagName.toLowerCase(),
            placeholder: input.placeholder?.slice(0, 100) ?? '',
            required: input.required,
            options,
          });
        }

        // Infer purpose from form content
        const formText = form.textContent?.toLowerCase() ?? '';
        const action = form.action ?? '';
        let purpose = 'unknown';
        if (fields.some((f) => f.type === 'password')) purpose = 'login';
        else if (fields.some((f) => f.type === 'search') || action.includes('search'))
          purpose = 'search';
        else if (formText.includes('sign up') || formText.includes('register'))
          purpose = 'register';
        else if (formText.includes('contact') || formText.includes('message'))
          purpose = 'contact';
        else if (fields.length > 3) purpose = 'create';
        else if (fields.length <= 2) purpose = 'filter';

        const submitBtn = form.querySelector(
          'button[type="submit"], input[type="submit"], button:not([type])',
        );
        const submitButtonText =
          submitBtn?.textContent?.trim() ?? submitBtn?.getAttribute('value') ?? 'Submit';

        return {
          id: form.id || `form_${index}`,
          action: form.action ?? '',
          method: (form.method ?? 'GET').toUpperCase(),
          purpose,
          fields,
          submitButtonText: submitButtonText.slice(0, 50),
        };
      })
      .filter((f) => f.fields.length > 0); // skip forms with no user-facing fields
  });

  return forms;
}
