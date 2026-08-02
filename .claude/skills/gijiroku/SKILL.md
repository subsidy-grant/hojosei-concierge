---
name: gijiroku
description: 音声データ(会議録音)を渡されたら、文字起こし→議事録要約→ファイルのリネーム・保存→タスク管理システムへのネクストアクション登録、まで一括で行う。「gijiroku」「議事録作って」「音声を文字起こしして要約」で発動。
---

# gijiroku 音声→議事録→タスク登録ループ

ダウンロードフォルダにある会議音声から、議事録の作成とネクストアクションの登録までを一気通貫で行う。詳細な経緯・過去の失敗と対処は memory の `feedback_audio_to_minutes_workflow` と `project_line_task_manager_v2` を参照(必ず先に読むこと。内容が古くなっていないか、このスキルの記述と食い違っていないか確認する)。

## 引数

`args` で音声ファイルのパスを直接指定できる。指定が無ければ「ダウンロードフォルダにある最新の音声ファイル」を対象にする。

## 手順

### 1. 対象ファイルの特定

```
ls -la ~/Downloads/*.m4a ~/Downloads/*.mp3 ~/Downloads/*.wav 2>/dev/null | sort -k6,7
```

最終更新が最新のものを選ぶ(`args`指定があればそちらを優先)。`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 <path>` で長さを確認しておく(所要時間の見積もりに使う)。

### 2. 文字起こし(ローカルWhisper・GPU)

**venvは `C:\Users\hiros\claude-tools\whisper_env` を使う。`%TEMP%`配下には絶対に作らない。**
理由: このPCでは`%TEMP%`配下のDLL実行(torch/numbaのネイティブ拡張)が何らかのポリシーで繰り返しブロック・破損しており(2026-07-30, 2026-08-01に再発)、tempスクラッチパッドのvenvは信頼できないと判明している。

- 存在確認: `"C:\Users\hiros\claude-tools\whisper_env\Scripts\python.exe" -c "import torch, whisper; print(torch.cuda.is_available())"` が `True` を返せばそのまま使う。
- 無い/壊れている場合は作り直す:
  ```
  "/c/Users/hiros/AppData/Local/Python/pythoncore-3.14-64/python.exe" -m venv "C:\Users\hiros\claude-tools\whisper_env"
  "C:\Users\hiros\claude-tools\whisper_env\Scripts\python.exe" -m pip install openai-whisper
  "C:\Users\hiros\claude-tools\whisper_env\Scripts\python.exe" -m pip install torch --index-url https://download.pytorch.org/whl/cu128
  ```
- ffmpegは `winget`(`Gyan.FFmpeg`)導入済みだがPATHが通っていない。実行時に
  `C:\Users\hiros\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin` をPATHへ追加する。
- 文字起こしスクリプトは `whisper.load_model("medium", device="cuda")` → `model.transcribe(path, language="ja", verbose=False)` → セグメントを`[hh:mm:ss] テキスト`形式で書き出す。**venvのpython.exeをフルパスで直接呼ぶ**(`source activate`やPATH経由の`python`/`pip`はこの環境で別プロジェクトの venv に化けることがあるため使わない)。
- 出力後、必ずハルシネーション検査をする: `wc -l`(総行数)と `awk -F'] ' '{print $2}' | sort -u | wc -l`(distinct行数)を比較し、先頭・末尾・中間を目視サンプリングする。無音区間での同一文字列の延々繰り返しが実例として過去にあった。

### 3. 議事録の構造化要約(サブエージェントへ委譲)

文字起こし結果(数千行になりうる)は自分で全部読まず、general-purposeサブエージェントに読ませて構造化抽出させる。プロンプトには以下を必ず含める:
- 参加者は原則たいら(平)とたかのぶ(会議中の呼称は「山本」)の2名。音声認識の誤表記(「たいら」→「体力」「タイア君」「田枝くん」「大洛くん」等)を伝え、文脈(質問側/報告側)から話者を推定させる
- 出力項目: ①話題ごとの要約(小見出し+箇条書き、発言者明記) ②出されたアイデア(提示順) ③決定事項(確定したものだけ、保守的に) ④ネクストアクション(担当者+内容+期日、期日は相対表現のまま抽出) ⑤備考(ASRハルシネーション区間、私的な会話の除外)

### 4. 議事録ファイルの作成

`D:\KOBAN事務\議事録\` にある既存ファイル(例: `2026-07-30議事録.md`)を1つ読んで、書式(見出し構成・敬称略・決定事項の太字・ネクストアクション表)を踏襲する。相対的な期日表現は、会議日(音声ファイルの更新日時、またはユーザーに確認した日付)を基準に絶対日付へ変換する。

### 5. ファイルのリネーム・移動

音声ファイルを `YYYY-MM-DD.m4a` 形式にリネームして `D:\KOBAN事務\議事録\` へ移動する(同日に複数ある場合は連番か内容が分かる接尾辞を付ける)。議事録は同じベース名+「議事録.md」で同フォルダに保存する。ダウンロードフォルダ直下やデスクトップ直下には置かない。

### 6. ネクストアクションのタスク登録(確認必須)

[[project_line_task_manager_v2]] の Supabase `tasks` テーブルへ直接INSERTする(旧line-task-bot/Googleスプレッドシートは2026-07-27に完全撤去済みで存在しない)。

- 接続情報: `D:\Claudecode\line-task-manager\app\.env` の `DATABASE_URL`
- `pg`パッケージは `app\node_modules` に既にあるので、Node.jsスクリプトを一時的に `app` 直下にコピーし `cwd` をそこにして実行する
- 必須列: `tenant_id`(常に1) / `title` / `short_title`(全角10文字以内) / `requester_id` / `assignee_id` / `due_date`(YYYY-MM-DD) / `group_id`(NULL可、共有したいなら`1`=「動作確認」グループ)
- membersは `1`=たいら、`2`=たかのぶ
- パスをJS文字列に埋め込むときはバックスラッシュでなくフォワードスラッシュを使う(エスケープ事故を避ける)
- **直接INSERTでも朝のバッチ(`ltm-morning`)が拾って実際にLINE通知が飛ぶ。書き込み前に必ず一覧を提示してユーザーの確認を取ること。省略しない。**
- 併せて「タスク管理ツール自体の改修」のような、システムには馴染まないメタタスクは、議事録のネクストアクションとしてのみ記録し、無理にDBへ登録しない。

## 停止条件

- 文字起こし・要約・ファイル保存までは自発的に進めてよい。
- **タスク登録の実書き込みだけは、内容確認なしに進めない。**
- 話者推定に確信が持てない箇所は、その旨を最終報告で明示する(断定しない)。
