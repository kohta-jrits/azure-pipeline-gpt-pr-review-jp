import fetch from 'node-fetch';
import { git } from './git';
import { OpenAIApi } from 'openai';
import { addCommentToPR } from './pr';
import { Agent } from 'https';
import * as tl from "azure-pipelines-task-lib/task";

export async function reviewFile(targetBranch: string, fileName: string, httpsAgent: Agent, apiKey: string, openai: OpenAIApi | undefined, aoiEndpoint: string | undefined) {
  console.log(`Start reviewing ${fileName} ...`);

  const defaultOpenAIModel = 'gpt-3.5-turbo';
  const patch = await git.diff([targetBranch, '--', fileName]);

  const instructions = `Act as a code reviewer of a Pull Request, providing feedback on possible bugs and clean code issues.
You are provided with the Pull Request changes in a patch format.
Each patch entry has the commit message in the Subject line followed by the code changes (diffs) in a unidiff format.

Your task:
- Review only added, edited, or deleted lines.
- If the changes are correct and there are no issues, respond with exactly: 'No feedback.'
- Do not write 'No feedback.' if any problems are found.

Please respond in Japanese.

⚠️ Respond **strictly** using the following format:

---

### 🛠 Required Fixes
- [Describe each issue as a bullet point]
- [Give concrete examples for how to fix each issue, ideally with code]

### 💡 Suggestions for Improvement
- [Give optional improvements in bullet point format]

---

Do not include any explanation or summary outside the above sections.
If there are no required fixes, still include an empty '### 🛠 Required Fixes' section.`;

  try {
    let choices: any;

    if (openai) {
      const response = await openai.createChatCompletion({
        model: tl.getInput('model') || defaultOpenAIModel,
        messages: [
          {
            role: "system",
            content: instructions
          },
          {
            role: "user",
            content: patch
          }
        ],
        max_tokens: 500
      });

      choices = response.data.choices
    }
    else if (aoiEndpoint) {
      const request = await fetch(aoiEndpoint, {
        method: 'POST',
        headers: { 'api-key': `${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_tokens: 800,
          messages: [
            {
              role: "developer",
              content: instructions,
            },
            {
              role: "user",
              content: patch,
            }
          ]
        })
      });

      const response = await request.json();

      choices = response.choices;
    }

    if (choices && choices.length > 0) {
      const review = choices[0].message?.content as string;

      if (review.trim() !== "No feedback.") {
        await addCommentToPR(fileName, review, httpsAgent);
      }
    }

    console.log(`Review of ${fileName} completed.`);
  }
  catch (error: any) {
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}
