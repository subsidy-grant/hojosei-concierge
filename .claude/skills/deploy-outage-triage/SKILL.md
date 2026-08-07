---
name: deploy-outage-triage
description: GitHub Actions/Pagesのデプロイが詰まる・失敗する・本番に反映されないときに、自分側（コード・設定）の問題かGitHub側の障害かを複数視点で切り分け、非破壊→破壊の順で対処する。「デプロイ詰まってる」「反映されてるか確認して」「Pagesビルドが進まない」「Actionsが失敗してる」で発動。
---

# デプロイ障害の切り分けと対処

**「詰まっている」の一次情報源を間違えると、原因も対処も全部間違える。** このスキルは
2026-08-06〜07にkoban-roadmapで実際に2回ハマった失敗から作った：1回目は原因を「アカウント固有の
キュー詰まり」と誤診断し、2回目はその誤診断の元になった`pages/builds/latest`を再び信用して
「2時間46分無反応」と誤報した（実際はワークフローが30分で失敗完了しており、腐った値を見ていただけ）。

## 適用の見分け方

**使う**：GitHub Actionsのワークフローが失敗・タイムアウトする、GitHub Pagesが古いまま反映されない、
「デプロイが止まっている」と疑われるとき全般。GitHub Pages以外のCI/CDでも考え方は流用できる。
**使わない**：コード自体のバグでビルドが落ちている（エラーログにコンパイルエラー・テスト失敗など
明確な自分側原因が出ている）場合は、これは不要で普通にコードを直す。

## 手順

### 1. 一次情報は「ビルドAPIの status」ではなく「実際のワークフロー実行」から取る

**`gh api repos/{owner}/{repo}/pages/builds/latest` の `status`/`updated_at` を鵜呑みにしない。**
このAPIは更新が遅れて古い値を返し続けることがある（2026-08-07実証：workflow run は30分で
`completed failure` していたのに、このAPIは2時間46分後も同じ`building`/同じ`updated_at`を返し続けた）。

必ずこちらを主たる一次情報にする：
```
gh run list --repo {owner}/{repo} --limit 5              # 実際の完了/失敗/所要時間
gh run view {run_id} --repo {owner}/{repo}                 # ANNOTATIONSに実際の失敗理由が出る
gh run view {run_id} --repo {owner}/{repo} --log-failed    # 失敗ログの実際の文言
```
`pages/builds/latest` は「今どのcommitが最新として認識されているか」の確認にのみ使い、
進捗の生死判定には使わない。

### 2. 自分側かGitHub側かを、最低3つの独立した視点で確認する

1つの視点（例：githubstatus.comがOperationalだった）だけで「自分側の問題」と決めない。
逆に1つのincidentが出ているだけで「GitHub側の問題」と決めない。次のうち複数を必ず当たる：

- **実際のエラー文言**：`gh run view --log-failed` のANNOTATIONSを読む。「ジョブがランナーに
  割り当てられない」「タイムアウト」のようなインフラ側の文言か、ビルドスクリプトのエラーのような
  自分側の文言かを見分ける
- **リポジトリ側の制約**：`gh api repos/{owner}/{repo}` でサイズ上限・`disabled`・`archived`、
  `gh api repos/{owner}/{repo}/pages` で設定を確認。ここに異常があれば自分側
- **失敗パターンの時間分散**：同じコミットで毎回同じ箇所・同じ所要時間で落ちるなら自分側の
  設定ミス濃厚。所要時間がバラバラ（25秒〜30分など）ならインフラ側の挙動を疑う
- **GitHubの公式ステータス（コンポーネント別）**：
  ```
  curl -s https://www.githubstatus.com/api/v2/summary.json
  ```
  `incidents/unresolved.json` だけでなく`summary.json`でコンポーネントごとのstatusを見る。
  Actions/Pagesだけ`major_outage`で他（Git Operations, API, Issues等）はOperational、という
  絞り込みが「Pagesビルド経路だけが落ちている」を裏付ける
- **同一アカウント内の他リポジトリとの比較**：
  ```
  gh api repos/{owner}/{other-repo}/pages/builds/latest
  ```
  同時期に他のPagesサイトも同様に詰まっているなら自分のリポジトリ固有ではなくアカウント/基盤側
- **既知事例の検索**：エラー文言そのままでWeb検索し、他ユーザーが同時期に同じ文言を報告していないか

**5視点中3つ以上が同じ結論を指したら確定とする。1〜2視点だけで断定して報告に書かない。**

### 3. 対処は非破壊から順に。飛ばさない

| 段階 | 対処 | 影響 | いつ使う |
|---|---|---|---|
| 1 | `gh run rerun {run_id} --failed` | 本番サイトへの影響なし | まず常にこれ |
| 2 | 空コミットで再push | 影響なし | 1で直らないとき |
| 3 | `gh api -X POST repos/{owner}/{repo}/pages/builds` | 影響なし | 2でも直らないとき |
| 4 | Pages機能をDELETE→POSTで無効化→再有効化 | **本番サイトが一時的に404になる** | 3までを1〜2周試して直らず、かつ下記の発動条件を満たすときのみ |

```bash
# 段階4（破壊的）
gh api -X DELETE repos/{owner}/{repo}/pages
gh api -X POST repos/{owner}/{repo}/pages -f "source[branch]=main" -f "source[path]=/"
```

**段階4の発動条件（両方満たすこと）**：
- 段階1〜3を試しても直らない
- GitHub全体の障害（`major_outage`等）が**現在進行中ではない**こと。全体障害の最中は受け皿
  （ランナー・ビルドキュー）自体が詰まっているので、無効化→再有効化しても同じ詰まりに戻るだけで、
  サイトを落とす代償だけを払うことになる。全体障害中は段階1（rerun）を待って回すほうが安全

実行後は`status:building`のまま数分〜10分動いていないように見えることがある。慌てて追加操作を
重ねず、`gh run list`で実際の完了を待ってから次を判断する。

**【2026-08-07追記】段階4はチャット内の承認だけでは実行できないことがある。** `gh api -X DELETE`/
`-X POST`のような破壊的コマンドをAuto modeの分類器がブロックし、ユーザーが「はい」と答えても
再実行時に同じブロックが起きた（エラー文言「the user can add a Bash permission rule to their
settings」）。これはチャット内の同意では解除されない種類の制約。段階4を計画する時点で、
実行できない可能性を織り込み、先に段階1〜2（rerun・空コミット）を尽くす方を優先する。

**【2026-08-07追記】GitHub全体障害が解消した直後でも、障害中に発行された既存ジョブは
「既に実行中」扱いで`rerun`を拒否することがある**（`run {id} cannot be rerun; This workflow is
already running`）。この場合はrerunに固執せず、**空コミットで新規workflow runをトリガーする方が
確実**（2026-08-07実証：空コミット後の新規runは24秒で`completed success`）。

### 4. 反映確認は本番で実ブラウザ検証まで行う

ビルドが`success`になっただけで終わらない。`curl -I`のLast-Modified更新→実際に対象の変更点
（新しいリンク・文言・機能）がPlaywright等の実ブラウザで動くところまで確認する。

## 待っている間にやること

GitHub側の障害待ちで手が空くときは、**ローカルで同一コミットのファイルをHTTPサーバーで配信し、
先に実ブラウザ検証を済ませておく**（本番反映後は同じスクリプトのURLを差し替えるだけで済む）。
監視は`Monitor`等でビルド状態・本番Last-Modified・障害解消を1分〜3分間隔でポーリングし、
自分はポーリングループで待たない。

## 停止条件

- `gh run list` で対象コミットの実行が `completed success` になった
- 本番のLast-Modifiedが更新された、または対象コンテンツが実ブラウザで確認できた
- 段階4まで実行してもなお直らない場合は、それ以上繰り返さず状況を書いて本人判断を仰ぐ

## 禁止事項

- `pages/builds/latest` の`status`/`updated_at`だけを根拠に「進捗が無い」「詰まっている」と断定する
- 1つの視点だけで「GitHub側の問題」「自分側の問題」と決めつける
- GitHub全体障害が進行中に段階4（無効化→再有効化）を打つ
- ビルド成功のログだけを見て「反映された」と報告し、実ブラウザ確認を省く

## 報告形式

「一次情報の出所と観測時刻（`gh run list`の結果、githubstatus.comの取得時刻）／自分側か外部かを
判定した視点とそれぞれの結果／打った対処とその段階／反映確認の証拠（Last-Modified・実ブラウザ）」。
断定文には出所と時刻を必ず添える（[[selfcheck_before_excuse]]と同じ規律）。

## 引き継ぎ（次回のために）

- 対象プロジェクトの`_tools/`配下の障害対処メモに、当該インシデントの実測値（所要時間・エラー文言・
  効いた/効かなかった対処）を追記する
- **`pages/builds/latest`を「実際のビルド状態」と書いた過去の記録があれば見つけ次第訂正する**
  （2026-08-06時点の記録にこの誤りがあり、2026-08-07に同じ誤診断を繰り返す原因になった）
