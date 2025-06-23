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

  const instructions = `あなたはコードレビュー担当者としてPull Requestの変更を確認し、バグやクリーンコード上の問題を日本語でレビューします。
        以下の内容に厳密に従ってください：

        ====================
        ## 出力フォーマット（絶対に変更しないこと）

        - **指摘が1つもない場合**は、"No feedback."（ダブルクォートなし）と**だけ**出力してください。

        - **指摘がどちらか一方にある場合や両方にある場合**は、以下のフォーマットに厳密に従って出力してください。  
          指摘がない項目については「（なし）」とだけ記載してください。

        ### 🛠 Required Fixes
        - [各問題点を簡潔に列挙してください]
        - [修正案があればコード付きで提案してください]
        （指摘がない場合は： （なし））

        ### 💡 Suggestions for Improvement
        - [任意の改善案・リファクタ案を列挙してください]
        （指摘がない場合は： （なし））

        ====================

        - diff形式の変更内容が与えられます。
        - 追加・編集・削除されたコード行のみをレビュー対象としてください。
        - "No feedback." は**指摘が完全に存在しない場合にのみ**出力してください。
        - 上記フォーマット以外の出力（説明や前後の文章）は絶対に書かないでください。`;

  try {
    let choices: any;

    if (openai) {
      console.log(`Use OpenAI`);

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
      console.log(`Use Azure OpenAI`);

      const request = await fetch(aoiEndpoint, {
        method: 'POST',
        headers: { 'api-key': `${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_tokens: 800,
          messages: [
            {
              role: "developer",
              content: [
                { type: "text", text: instructions }
              ]
            },
            {
              role: "user",
              content: patch
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

    console.log(`Review of ${fileName} completed!`);
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
