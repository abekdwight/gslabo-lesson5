# Laravel 3 — 家計簿を全国平均と比べる

## 前回のおさらいと、今回のゴール

前回は、編集と削除を作って家計簿の操作をそろえました。あわせて、フラッシュメッセージ・FormRequest・エラーメッセージの日本語化で、フォームまわりを整えました。今日はその続きで、この講座の最終回です。

ゴールは、一覧の上に「今月の光熱費」と「全国平均」を並べて表示することです。

```
今月の光熱費　合計 ¥12,280 ／ 全国平均 ¥19,837
```

自分の合計は家計簿のデータベースから集計し、全国平均は政府統計（e-Stat）の API から取得します。家計簿が、外部のサービスと通信するアプリになります。

手を入れるファイルは次の5つです。

| ファイル                                          | 今日やること                                            |
| ------------------------------------------------- | ------------------------------------------------------- |
| `.env`                                            | `ESTAT_APP_ID` を1行追加する                            |
| `config/estat.php`                                | 新規作成。API の設定をまとめる                          |
| `app/Services/StatisticsService.php`              | 新規作成。e-Stat から全国平均を取得する                 |
| `app/Http/Controllers/TransactionController.php`  | `index()` で合計を集計し、サービスクラスを受け取る      |
| `resources/views/transactions/index.blade.php`    | 比較の表示を足す                                        |

## 今日学ぶこと

| 言葉                                     | ざっくり言うと                                                       | 登場する場面 |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------ |
| **クエリメソッド（whereIn / sum など）** | 検索や集計の条件を組み立てて、データベースに計算させる書き方         | ①            |
| **HTTP クライアント（Http）**            | PHP のコードから外部の URL を呼び出す機能                            | ②            |
| **.env と config**                       | API キーのような、コードに直接書かない値の置き場所                   | ④            |
| **サービスクラス**                       | コントローラから処理を分けて置く、自作の PHP クラス                  | ⑤            |
| **サービスコンテナ**                     | 型宣言されたクラスのインスタンスを作って渡す、Laravel の仕組み       | ⑤            |
| **メソッドインジェクション**             | メソッドの引数に型を書いて、サービスコンテナから受け取る書き方       | ⑤            |
| **依存注入（DI）**                       | 必要なクラスを自分で new せず、引数で受け取る形                      | ⑤            |

## 事前準備

- **Docker Desktop** が動くこと。
- **前回まで作ってきた kakeibo プロジェクト**をそのまま使います。
- **ほかの Laravel プロジェクトの Sail が動いている場合は、止めておいてください。** 同じポートを使うため、動いたままだと家計簿が起動できません。そのプロジェクトのフォルダで次を実行します。

```sh
./vendor/bin/sail down
```

- kakeibo を起動しておきます。

```sh
cd kakeibo
./vendor/bin/sail up -d
```

- 今日は外部の API を呼び出すため、インターネット接続が必要です。
- e-Stat の API キー（appId）を使います。キーは授業内で共有します。

??? note "前回のプロジェクトが手元に無い場合（クリックで開く）"

    前回を欠席した場合や、プロジェクトが動かなくなった場合は、前回完了時点のプロジェクトを取得して、そこから始められます。

    ```sh
    git clone https://github.com/abekdwight/gslabo-lesson5.git
    cd gslabo-lesson5/kakeibo
    docker run --rm -v "$(pwd)":/opt -w /opt laravelsail/php84-composer:latest composer install
    cp .env.example .env
    ./vendor/bin/sail up -d
    ./vendor/bin/sail artisan key:generate
    ./vendor/bin/sail artisan migrate --seed
    ```

    最後の `--seed` で、カテゴリ10件と取引3件が入ります。初回は Docker イメージの取得と `composer install` に数分かかります。以降は、このフォルダを自分のプロジェクトとして使ってください。

!!! success "確認"

    ブラウザで `http://localhost/transactions` を開いて、一覧が表示されれば準備完了です。

!!! warning "つまずきポイント：起動できない"

    `port is already allocated` / `Address already in use`：ほかのプロジェクトの Sail が動いたままです。そのプロジェクトのフォルダで `./vendor/bin/sail down` してから、もう一度 `sail up -d` を実行してください。

## ① 今月の光熱費を合計する

まず、比べる元になるデータを入れます。「取引を追加」から、今月の日付で「電気代」「ガス代」「水道代」を1件ずつ登録してください。金額は実際の支払いに近い数字だと、あとの比較が実感に近くなります。

次に、合計の出し方を tinker で組み立てます。

```sh
./vendor/bin/sail artisan tinker
```

カテゴリの名前から、対象のカテゴリ ID を取り出します。

```php
$utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
$utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');
```

```
[!] Aliasing 'Category' to 'App\Models\Category' for this Tinker session.
= Illuminate\Support\Collection {#5100
    all: [
      2,
      3,
      4,
    ],
  }
```

1行目の `[!] Aliasing ...` は、このクラスを tinker で初めて使ったときに1回だけ出る通知で、エラーではありません。

`whereIn('name', [...])` は「このどれかに一致する」条件です。`pluck('id')` は、見つかった行から `id` の列だけを取り出します。ID を直接 `[2, 3, 4]` と書かないのは、ID が登録の順番で決まる値だからです。名前で調べれば、どの環境でも同じカテゴリを指せます。

今月の合計を出します。

```php
Transaction::whereIn('category_id', $utilityCategoryIds)->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])->sum('amount');
```

```
[!] Aliasing 'Transaction' to 'App\Models\Transaction' for this Tinker session.
= 12280
```

表示される金額は、登録した内容によって変わります。

- `whereBetween('occurred_at', [開始, 終了])` は「この範囲に入る」条件です。`now()` は現在日時で、`startOfMonth()` と `endOfMonth()` で今月の初日と末日にできます。
- `sum('amount')` は、条件に合った行の `amount` を合計します。
- メソッドをつなぐたびに問い合わせの条件が組み上がり、`sum()` などを呼んだ時点で SQL が実行されます。計算するのはデータベースで、PHP 側にループは書きません。[クエリビルダ](https://readouble.com/laravel/13.x/ja/queries.html)

合計を一覧の上に表示します。`resources/views/transactions/index.blade.php` の `<table>` の上に追加します。

=== "追加する部分"

    ```blade
    <h2>今月の光熱費</h2>
    <p>合計 ¥{{ number_format($thisMonthUtilityTotal) }}</p>
    ```

=== "index.blade.php 全文"

    ```blade
    <x-layout>
        <h2>今月の光熱費</h2>
        <p>合計 ¥{{ number_format($thisMonthUtilityTotal) }}</p>

        <table>
            <thead>
                <tr>
                    <th>日付</th>
                    <th>カテゴリ</th>
                    <th>区分</th>
                    <th class="amount">金額</th>
                    <th>メモ</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($transactions as $transaction)
                    <tr>
                        <td>{{ $transaction->occurred_at }}</td>
                        <td>{{ $transaction->category->name }}</td>
                        <td>{{ $transaction->type === 'income' ? '収入' : '支出' }}</td>
                        <td class="amount">¥{{ number_format($transaction->amount) }}</td>
                        <td>{{ $transaction->note }}</td>
                        <td>
                            <a href="{{ route('transactions.edit', $transaction) }}">編集</a>
                            <form method="POST" action="{{ route('transactions.destroy', $transaction) }}">
                                @csrf
                                @method('DELETE')
                                <button type="submit" onclick="return confirm('本当に削除しますか？')">削除</button>
                            </form>
                        </td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </x-layout>
    ```

ビューが使う `$thisMonthUtilityTotal` を、コントローラで用意します。tinker で組み立てた集計を、そのまま `index()` に書きます。`app/Http/Controllers/TransactionController.php` を書き換えます。

=== "書き換える部分"

    ```php
    public function index()
    {
        $transactions = Transaction::with('category')->latest('occurred_at')->get();

        $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
        $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

        $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
            ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
            ->sum('amount');

        return view('transactions.index', [
            'transactions' => $transactions,
            'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
        ]);
    }
    ```

=== "TransactionController.php 全文"

    ```php
    <?php

    namespace App\Http\Controllers;

    use App\Http\Requests\TransactionRequest;
    use App\Models\Category;
    use App\Models\Transaction;

    class TransactionController extends Controller
    {
        /**
         * Display a listing of the resource.
         */
        public function index()
        {
            $transactions = Transaction::with('category')->latest('occurred_at')->get();

            $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
            $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

            $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
                ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
                ->sum('amount');

            return view('transactions.index', [
                'transactions' => $transactions,
                'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
            ]);
        }

        /**
         * Show the form for creating a new resource.
         */
        public function create()
        {
            return view('transactions.create', [
                'categories' => Category::all(),
            ]);
        }

        /**
         * Store a newly created resource in storage.
         */
        public function store(TransactionRequest $request)
        {
            $validated = $request->validated();

            Transaction::create($validated);

            return redirect('/transactions')->with('message', '登録しました');
        }

        /**
         * Display the specified resource.
         */
        public function show(Transaction $transaction)
        {
            //
        }

        /**
         * Show the form for editing the specified resource.
         */
        public function edit(Transaction $transaction)
        {
            return view('transactions.edit', [
                'transaction' => $transaction,
                'categories' => Category::all(),
            ]);
        }

        /**
         * Update the specified resource in storage.
         */
        public function update(TransactionRequest $request, Transaction $transaction)
        {
            $validated = $request->validated();

            $transaction->update($validated);

            return redirect('/transactions')->with('message', '更新しました');
        }

        /**
         * Remove the specified resource from storage.
         */
        public function destroy(Transaction $transaction)
        {
            $transaction->delete();

            return redirect('/transactions')->with('message', '削除しました');
        }
    }
    ```

!!! success "確認"

    一覧の上に「今月の光熱費」と、いま登録した金額の合計が表示されれば成功です。

!!! warning "つまずきポイント：合計が出ない"

    - `Undefined variable $thisMonthUtilityTotal`：コントローラでビューに渡す配列のキー名と、ビューの変数名がそろっているか確認してください。
    - 合計が 0 円になる：登録した取引の日付が今月になっているか、カテゴリが「電気代」「ガス代」「水道代」になっているかを一覧で確認してください。

## ② 統計 API を呼び出してみる

比べる相手の全国平均は、政府統計の総合窓口（e-Stat）の API から取得します。家計調査という統計に、二人以上の世帯が1ヶ月に払う「光熱・水道」の平均額があります。

API は、プログラムから呼び出すための URL です。開くと、HTML の画面ではなくデータ（JSON）が返ります。

共有された appId を、次の欄に貼り付けてください。このページのコードの `（共有されたキー）` の部分が、貼り付けた値に置き換わります（値はこのブラウザにだけ保存されます）。

<p><input type="text" id="estat-app-id" placeholder="共有された appId を貼り付け" style="width: 100%; max-width: 480px; font-family: monospace; padding: 4px 8px;"></p>

まずブラウザで開いてみます。次の URL を開いてください。

```
https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?appId=（共有されたキー）&statsDataId=0002070008&cdTab=01&cdCat01=107&cdCat02=03&cdCat03=00&cdArea=00000&cdTime=2026000606
```

ブラウザに JSON が表示されます。整形して、途中を省略すると、次の形をしています。

```json
{
  "GET_STATS_DATA": {
    "RESULT": {
      "STATUS": 0,
      "ERROR_MSG": "正常に終了しました。",
      "DATE": "2026-08-25T00:18:49.189+09:00"
    },
    "PARAMETER": { ... },
    "STATISTICAL_DATA": {
      "RESULT_INF": { ... },
      "TABLE_INF": { ... },
      "CLASS_INF": { ... },
      "DATA_INF": {
        "NOTE": [ ... ],
        "VALUE": {
          "@tab": "01",
          "@cat01": "107",
          "@cat02": "03",
          "@cat03": "00",
          "@area": "00000",
          "@time": "2026000606",
          "@unit": "円",
          "$": "19837"
        }
      }
    }
  }
}
```

探している金額は、`VALUE` の中の `$` というキーに入っています（この API は、数値そのものを `$` というキー名で返します）。`@cat01` や `@time` は、その値がどの分類・どの月のものかを示しています。

URL の後半に並んでいたパラメータの意味は次のとおりです。

| パラメータ    | 値           | 意味                                       |
| ------------- | ------------ | ------------------------------------------ |
| `appId`       | 共有されたキー | 利用登録で発行される ID                    |
| `statsDataId` | `0002070008` | 統計表の ID（家計調査・用途分類）          |
| `cdTab`       | `01`         | 表の種類（金額）                           |
| `cdCat01`     | `107`        | 項目（光熱・水道）                         |
| `cdCat02`     | `03`         | 世帯の区分（二人以上の世帯）               |
| `cdCat03`     | `00`         | 世帯人員（平均）                           |
| `cdArea`      | `00000`      | 地域（全国）                               |
| `cdTime`      | `2026000606` | 対象の月（2026年6月）                      |

同じ呼び出しを、PHP から行います。①で開いた tinker に戻って実行してください。

```php
$response = Http::get('https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData', [
    'appId' => '（共有されたキー）',
    'statsDataId' => '0002070008',
    'cdTab' => '01',
    'cdCat01' => '107',
    'cdCat02' => '03',
    'cdCat03' => '00',
    'cdArea' => '00000',
    'cdTime' => '2026000606',
]);
```

`Http::get(URL, [...])` は、第2引数の配列を `?appId=...&statsDataId=...` の形に組み立てて送ります。ブラウザで開いたのと同じ URL です。[HTTPクライアント](https://readouble.com/laravel/13.x/ja/http-client.html)

`Http` は、PHP で広く使われてきた HTTP クライアントの Guzzle を、Laravel が使いやすく包んだものです。少し前までは、Guzzle をそのまま使う書き方が一般的でした。どちらも、JavaScript でいう axios にあたる立ち位置のライブラリです。[Guzzle](https://docs.guzzlephp.org/en/stable/)

返ってきた JSON を、PHP の配列として取り出します。

```php
$response->json();
```

```
= [
    "GET_STATS_DATA" => [
      "RESULT" => [
        "STATUS" => 0,
        ...
```

`json()` は、応答の JSON を PHP の配列にします。必要なのは金額だけなので、キーを `.` でつないで直接取り出します。

```php
$response->json('GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE.$');
```

```
= "19837"
```

全国平均の金額が、文字列で取れました。

!!! success "確認"

    金額の文字列が表示されれば成功です。

!!! warning "つまずきポイント：null が返る"

    金額の代わりに `null` が返るときは、応答の `RESULT` を見ます。

    ```php
    $response->json('GET_STATS_DATA.RESULT');
    ```

    `ERROR_MSG` に理由が入っています。「認証に失敗しました。アプリケーションIDを確認してください。」なら、`appId` の貼り間違いです。

## ③ コントローラに組み込む

一覧に全国平均を足します。`resources/views/transactions/index.blade.php` の「今月の光熱費」の段落を書き換えます。

=== "書き換える部分"

    ```blade
    <h2>今月の光熱費</h2>
    <p>
        合計 ¥{{ number_format($thisMonthUtilityTotal) }}
        @if ($nationalAverageUtilityCost !== null)
            ／ 全国平均 ¥{{ number_format($nationalAverageUtilityCost) }}
        @endif
    </p>
    ```

=== "index.blade.php 全文"

    ```blade
    <x-layout>
        <h2>今月の光熱費</h2>
        <p>
            合計 ¥{{ number_format($thisMonthUtilityTotal) }}
            @if ($nationalAverageUtilityCost !== null)
                ／ 全国平均 ¥{{ number_format($nationalAverageUtilityCost) }}
            @endif
        </p>

        <table>
            <thead>
                <tr>
                    <th>日付</th>
                    <th>カテゴリ</th>
                    <th>区分</th>
                    <th class="amount">金額</th>
                    <th>メモ</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($transactions as $transaction)
                    <tr>
                        <td>{{ $transaction->occurred_at }}</td>
                        <td>{{ $transaction->category->name }}</td>
                        <td>{{ $transaction->type === 'income' ? '収入' : '支出' }}</td>
                        <td class="amount">¥{{ number_format($transaction->amount) }}</td>
                        <td>{{ $transaction->note }}</td>
                        <td>
                            <a href="{{ route('transactions.edit', $transaction) }}">編集</a>
                            <form method="POST" action="{{ route('transactions.destroy', $transaction) }}">
                                @csrf
                                @method('DELETE')
                                <button type="submit" onclick="return confirm('本当に削除しますか？')">削除</button>
                            </form>
                        </td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </x-layout>
    ```

`@if` は、平均が取得できなかったとき（null のとき）に、その部分だけ表示しない分岐です。

ビューが使う `$nationalAverageUtilityCost` を、コントローラで用意します。tinker に打った呼び出しを、そのまま `index()` に書きます。`app/Http/Controllers/TransactionController.php` を書き換えます。`use` に `Http` の1行を足し、`index()` に通信と、ビューに渡す1行を足します。

=== "書き換える部分"

    ```php
    use Illuminate\Support\Facades\Http;
    ```

    ```php
    public function index()
    {
        $transactions = Transaction::with('category')->latest('occurred_at')->get();

        $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
        $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

        $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
            ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
            ->sum('amount');

        $response = Http::get('https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData', [
            'appId' => '（共有されたキー）',
            'statsDataId' => '0002070008',
            'cdTab' => '01',
            'cdCat01' => '107',
            'cdCat02' => '03',
            'cdCat03' => '00',
            'cdArea' => '00000',
            'cdTime' => '2026000606',
        ]);
        $nationalAverageUtilityCost = $response->json('GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE.$');

        return view('transactions.index', [
            'transactions' => $transactions,
            'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
            'nationalAverageUtilityCost' => $nationalAverageUtilityCost,
        ]);
    }
    ```

=== "TransactionController.php 全文"

    ```php
    <?php

    namespace App\Http\Controllers;

    use App\Http\Requests\TransactionRequest;
    use App\Models\Category;
    use App\Models\Transaction;
    use Illuminate\Support\Facades\Http;

    class TransactionController extends Controller
    {
        /**
         * Display a listing of the resource.
         */
        public function index()
        {
            $transactions = Transaction::with('category')->latest('occurred_at')->get();

            $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
            $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

            $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
                ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
                ->sum('amount');

            $response = Http::get('https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData', [
                'appId' => '（共有されたキー）',
                'statsDataId' => '0002070008',
                'cdTab' => '01',
                'cdCat01' => '107',
                'cdCat02' => '03',
                'cdCat03' => '00',
                'cdArea' => '00000',
                'cdTime' => '2026000606',
            ]);
            $nationalAverageUtilityCost = $response->json('GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE.$');

            return view('transactions.index', [
                'transactions' => $transactions,
                'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
                'nationalAverageUtilityCost' => $nationalAverageUtilityCost,
            ]);
        }

        /**
         * Show the form for creating a new resource.
         */
        public function create()
        {
            return view('transactions.create', [
                'categories' => Category::all(),
            ]);
        }

        /**
         * Store a newly created resource in storage.
         */
        public function store(TransactionRequest $request)
        {
            $validated = $request->validated();

            Transaction::create($validated);

            return redirect('/transactions')->with('message', '登録しました');
        }

        /**
         * Display the specified resource.
         */
        public function show(Transaction $transaction)
        {
            //
        }

        /**
         * Show the form for editing the specified resource.
         */
        public function edit(Transaction $transaction)
        {
            return view('transactions.edit', [
                'transaction' => $transaction,
                'categories' => Category::all(),
            ]);
        }

        /**
         * Update the specified resource in storage.
         */
        public function update(TransactionRequest $request, Transaction $transaction)
        {
            $validated = $request->validated();

            $transaction->update($validated);

            return redirect('/transactions')->with('message', '更新しました');
        }

        /**
         * Remove the specified resource from storage.
         */
        public function destroy(Transaction $transaction)
        {
            $transaction->delete();

            return redirect('/transactions')->with('message', '削除しました');
        }
    }
    ```

!!! success "確認"

    一覧の上に「合計 ¥…… ／ 全国平均 ¥……」と並べば成功です。

!!! warning "つまずきポイント：全国平均が出ない"

    - コントローラに貼ったコードの `appId` が `（共有されたキー）` の文字のまま残っていないか確認してください。
    - ②の tinker では取れていたかを思い出してください。取れていなかった場合は、②のつまずきポイント（`RESULT` の見方）で理由を確認できます。

全国平均は統計の集計月、自分の合計は今月なので、月がずれた比較です。それでも「自分の光熱費は平均とどのくらい違うか」の目安には十分です。

## ④ キーを .env と config に移す

動きましたが、コントローラにキーがそのまま書いてあります。このファイルをコミットすると、キーごと Git に入って公開されてしまいます。キーのような秘密の値は、コードではなく `.env` に置きます。

`.env` は前回、`APP_LOCALE=ja` で書き換えたファイルです。末尾に1行追加します。

```
ESTAT_APP_ID=（共有されたキー）
```

`=` の前後にスペースは入れません。`.env` が Git に入らないことは、`.gitignore` を開くと確認できます。`.env` の行があり、コミットの対象から外れています。

!!! warning "注意：キーの扱い"

    appId は、コードや GitHub に書かないでください。置き場所は `.env` だけです。

コントローラを、`.env` を読む形に書き換えます。`index()` の `'appId'` の行を変えます。

```php
'appId' => env('ESTAT_APP_ID'),
```

`env('ESTAT_APP_ID')` は、`.env` の値を読む関数です。前回、`config/app.php` の中に `'locale' => env('APP_LOCALE', 'en')` と書かれているのを見ました。同じ形です。

!!! success "確認"

    一覧をリロードして、③と同じ表示のまま動けば成功です。キーはコードから消えました。

ただ、`env()` をコントローラから直接呼ぶ形も、よくありません。Laravel には、全 config ファイルの読み込み結果を1つのファイルにまとめておく `config:cache` というコマンドがあり、本番環境では起動を速くするために実行するのが定石です。実行後の Laravel は `.env` を読み込まなくなるため、アプリのコードに書いた `env()` は値を返さなくなります。config ファイルの中の `env()` は、まとめる時点で実行され、結果の値が保存されます。そのため `config()` は、実行後も同じ値を返します。設定値がコードのあちこちに散らばっていく問題もあります。環境の値は config のファイルで受けて、アプリのコードは `config()` で読む形にします。

その config のファイルを作ります。`config/estat.php` を新規作成します。

```php
<?php

return [
    'app_id' => env('ESTAT_APP_ID'),
    'endpoint' => 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData',
    'stats_data_id' => '0002070008',
];
```

`config/` のファイルは、配列を return するだけの PHP ファイルです。ファイル名とキーをつないで、`config('estat.app_id')` のように読めます。前回 `config/app.php` で見た形を、今回は自分で書きます。

URL と統計表 ID もここに置きました。キーと違って秘密ではありませんが、「どの API をどう呼ぶか」という設定値は、処理のコードと分けて1箇所に集めます。

コントローラを、config から読む形に書き換えます。URL・キー・統計表 ID の3箇所です。

=== "書き換える部分"

    ```php
    $response = Http::get(config('estat.endpoint'), [
        'appId' => config('estat.app_id'),
        'statsDataId' => config('estat.stats_data_id'),
        'cdTab' => '01',
        'cdCat01' => '107',
        'cdCat02' => '03',
        'cdCat03' => '00',
        'cdArea' => '00000',
        'cdTime' => '2026000606',
    ]);
    ```

=== "TransactionController.php 全文"

    ```php
    <?php

    namespace App\Http\Controllers;

    use App\Http\Requests\TransactionRequest;
    use App\Models\Category;
    use App\Models\Transaction;
    use Illuminate\Support\Facades\Http;

    class TransactionController extends Controller
    {
        /**
         * Display a listing of the resource.
         */
        public function index()
        {
            $transactions = Transaction::with('category')->latest('occurred_at')->get();

            $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
            $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

            $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
                ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
                ->sum('amount');

            $response = Http::get(config('estat.endpoint'), [
                'appId' => config('estat.app_id'),
                'statsDataId' => config('estat.stats_data_id'),
                'cdTab' => '01',
                'cdCat01' => '107',
                'cdCat02' => '03',
                'cdCat03' => '00',
                'cdArea' => '00000',
                'cdTime' => '2026000606',
            ]);
            $nationalAverageUtilityCost = $response->json('GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE.$');

            return view('transactions.index', [
                'transactions' => $transactions,
                'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
                'nationalAverageUtilityCost' => $nationalAverageUtilityCost,
            ]);
        }

        /**
         * Show the form for creating a new resource.
         */
        public function create()
        {
            return view('transactions.create', [
                'categories' => Category::all(),
            ]);
        }

        /**
         * Store a newly created resource in storage.
         */
        public function store(TransactionRequest $request)
        {
            $validated = $request->validated();

            Transaction::create($validated);

            return redirect('/transactions')->with('message', '登録しました');
        }

        /**
         * Display the specified resource.
         */
        public function show(Transaction $transaction)
        {
            //
        }

        /**
         * Show the form for editing the specified resource.
         */
        public function edit(Transaction $transaction)
        {
            return view('transactions.edit', [
                'transaction' => $transaction,
                'categories' => Category::all(),
            ]);
        }

        /**
         * Update the specified resource in storage.
         */
        public function update(TransactionRequest $request, Transaction $transaction)
        {
            $validated = $request->validated();

            $transaction->update($validated);

            return redirect('/transactions')->with('message', '更新しました');
        }

        /**
         * Remove the specified resource from storage.
         */
        public function destroy(Transaction $transaction)
        {
            $transaction->delete();

            return redirect('/transactions')->with('message', '削除しました');
        }
    }
    ```

!!! info "ポイント：env() を書くのは config の中だけ"

    `.env` の値は config だけが読み、アプリのコード（コントローラや、この後作るサービスクラス）は `config()` で読みます。この形にしておけば、本番で `env()` が値を返さなくなる問題は起きません。[設定](https://readouble.com/laravel/13.x/ja/configuration.html)

!!! success "確認"

    一覧をリロードして、表示が変わらず動けば成功です。キーも URL も統計表 ID も、`.env` と config に移りました。

説明のとおりになるか、`config:cache` を実行して確かめます。

```sh
./vendor/bin/sail artisan config:cache
```

一覧をリロードしても、表示は変わりません。`config()` が、まとめたときに保存された値を返しているためです。`env()` との差は tinker で見えます。

```sh
./vendor/bin/sail artisan tinker
```

```php
env('ESTAT_APP_ID');
```

```
= null
```

```php
config('estat.app_id');
```

```
= "（共有されたキーが表示される）"
```

開発中はキャッシュを使いません。`.env` や config を変えるたびに、まとめ直しが必要になるためです。exit で tinker を抜けて、元に戻します。

```sh
./vendor/bin/sail artisan config:clear
```

!!! success "確認"

    `config:clear` のあとに一覧をリロードして、今までどおり表示されれば、元に戻っています。

!!! warning "つまずきポイント：全国平均が出なくなった"

    - `.env` の行が `ESTAT_APP_ID=キー` の形になっているか（スペースや引用符が入っていないか）確認してください。
    - `config/estat.php` のキー名（`app_id` / `endpoint` / `stats_data_id`）と、コントローラで読んでいる名前がそろっているか確認してください。
    - それでも直らないときは、`./vendor/bin/sail artisan config:clear` を実行してからリロードしてください。

## ⑤ 通信をサービスクラスに移して、引数で受け取る

`index()` が長くなりました。一覧の取得、集計、外部との通信、ビューへの受け渡しが、1つのメソッドに入っています。このうち外部のサービスとの通信は、コントローラに直接書かず、通信だけを受け持つクラスに分けて置くのが定石です。コントローラの仕事はリクエストを受けて結果をビューに渡すことで、どの URL をどんなパラメータで呼ぶかは、別の関心事だからです。この形のクラスを**サービスクラス**と呼びます。

これまでのクラスと違って、`make:controller` や `make:request` のような生成コマンドはありません。サービスクラスは Laravel の部品ではなく、ただの PHP クラスです。置き場所は `app/Services/` にするのが慣例で、フォルダから自分で作ります。

`app/Services/StatisticsService.php` を新規作成します。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class StatisticsService
{
    /**
     * 「光熱・水道」の全国平均月額（円）を返す。応答から金額を取れなかったときは null。
     */
    public function nationalAverageUtilityCost(): ?int
    {
        $response = Http::timeout(5)->get(config('estat.endpoint'), [
            'appId' => config('estat.app_id'),
            'statsDataId' => config('estat.stats_data_id'),
            'cdTab' => '01',
            'cdCat01' => '107',
            'cdCat02' => '03',
            'cdCat03' => '00',
            'cdArea' => '00000',
            'cdTime' => '2026000606',
        ]);

        $nationalAverageValue = $response->json('GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE.$');

        if ($nationalAverageValue === null) {
            return null;
        }

        return (int) $nationalAverageValue;
    }
}
```

中身は④までコントローラにあった呼び出しを移したもので、次の3つを足しました。

- `timeout(5)`：相手が応答しないとき、5秒で打ち切る指定です。
- 戻り値の型 `?int`：「int または null」という意味です。応答に金額が無いとき（キーの間違い、API 側の障害など）、`json('...')` は null を返すので、それをそのまま null として返します。
- `(int)`：金額は文字列で返ってくるので、整数にして返します。

作ったクラスを tinker で動かします。tinker が新しいクラスを短い名前で見つけられるように、先に `dump-autoload` を実行してから開きます。

```sh
./vendor/bin/sail composer dump-autoload
./vendor/bin/sail artisan tinker
```

```php
$statisticsService = new StatisticsService();
$statisticsService->nationalAverageUtilityCost();
```

```
[!] Aliasing 'StatisticsService' to 'App\Services\StatisticsService' for this Tinker session.
= 19837
```

!!! success "確認"

    数値が表示されれば、サービスクラス単体で動いています。

`new` で作って、そのまま呼び出せました。次に、コントローラから使います。

`TransactionController.php` を書き換えます。`use` に `StatisticsService` の1行を足し、`index()` の中の通信を消して、引数で受け取ります。もう使わなくなる `use Illuminate\Support\Facades\Http;` は消します。

=== "書き換える部分"

    ```php
    use App\Services\StatisticsService;
    ```

    ```php
    public function index(StatisticsService $statisticsService)
    {
        $transactions = Transaction::with('category')->latest('occurred_at')->get();

        $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
        $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

        $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
            ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
            ->sum('amount');

        return view('transactions.index', [
            'transactions' => $transactions,
            'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
            'nationalAverageUtilityCost' => $statisticsService->nationalAverageUtilityCost(),
        ]);
    }
    ```

=== "TransactionController.php 全文"

    ```php
    <?php

    namespace App\Http\Controllers;

    use App\Http\Requests\TransactionRequest;
    use App\Models\Category;
    use App\Models\Transaction;
    use App\Services\StatisticsService;

    class TransactionController extends Controller
    {
        /**
         * Display a listing of the resource.
         */
        public function index(StatisticsService $statisticsService)
        {
            $transactions = Transaction::with('category')->latest('occurred_at')->get();

            $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
            $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

            $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
                ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
                ->sum('amount');

            return view('transactions.index', [
                'transactions' => $transactions,
                'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
                'nationalAverageUtilityCost' => $statisticsService->nationalAverageUtilityCost(),
            ]);
        }

        /**
         * Show the form for creating a new resource.
         */
        public function create()
        {
            return view('transactions.create', [
                'categories' => Category::all(),
            ]);
        }

        /**
         * Store a newly created resource in storage.
         */
        public function store(TransactionRequest $request)
        {
            $validated = $request->validated();

            Transaction::create($validated);

            return redirect('/transactions')->with('message', '登録しました');
        }

        /**
         * Display the specified resource.
         */
        public function show(Transaction $transaction)
        {
            //
        }

        /**
         * Show the form for editing the specified resource.
         */
        public function edit(Transaction $transaction)
        {
            return view('transactions.edit', [
                'transaction' => $transaction,
                'categories' => Category::all(),
            ]);
        }

        /**
         * Update the specified resource in storage.
         */
        public function update(TransactionRequest $request, Transaction $transaction)
        {
            $validated = $request->validated();

            $transaction->update($validated);

            return redirect('/transactions')->with('message', '更新しました');
        }

        /**
         * Remove the specified resource from storage.
         */
        public function destroy(Transaction $transaction)
        {
            $transaction->delete();

            return redirect('/transactions')->with('message', '削除しました');
        }
    }
    ```

!!! success "確認"

    **見た目が何も変わらないことが成功です。** 表示は④までと同じで、違いはコードの側にあります。外部との通信が StatisticsService の1箇所にまとまり、`index()` は集計と受け渡しに戻りました。

!!! warning "つまずきポイント：エラーになる・平均が出ない"

    - `Class "App\Services\StatisticsService" does not exist`：コントローラの `use App\Services\StatisticsService;` の書き忘れか、ファイルの置き場所・`namespace App\Services;` の書き間違いです。
    - 合計だけが表示される：平均が null です。tinker で `(new StatisticsService())->nationalAverageUtilityCost()` を実行して、②のつまずきポイント（`RESULT` の見方）で理由を確かめてください。

### 引数は Laravel が用意している

`$statisticsService` には、StatisticsService のインスタンスが入っていました。`new` を書いたのは tinker の中だけで、コントローラには型宣言しかありません。

Laravel は、コントローラのメソッドを呼ぶ前に引数の型宣言を見て、必要なものを用意してから呼び出します。今日の StatisticsService だけでなく、これまで書いてきた引数も、この仕組みで渡されていました。

```php
// 新しく作ったインスタンスが渡される
public function index(StatisticsService $statisticsService) {}

// 処理中のリクエストが渡される
public function store(Request $request) {}

// rules() の検証を通ってから渡される。失敗したらこのメソッドは呼ばれない
public function store(TransactionRequest $request) {}

// URL の {transaction} と同名なので、データベースから探した1件が渡される。見つからなければ 404
public function edit(Transaction $transaction) {}
```

この解決を担当しているのが**サービスコンテナ**です。引数の型宣言で受け取る書き方を**メソッドインジェクション**と呼びます。[コントローラと依存注入](https://readouble.com/laravel/13.x/ja/controllers.html#dependency-injection-and-controllers)、[サービスコンテナ](https://readouble.com/laravel/13.x/ja/container.html)

tinker から、コンテナに作らせることもできます。

```php
app(StatisticsService::class);
```

```
= App\Services\StatisticsService {#5210}
```

`app(クラス名)` が「サービスコンテナに用意させる」呼び出しで、コントローラの引数に入ってくるのは、この結果と同じものです。

前回、`store(Request $request)` の `Request` を `TransactionRequest` に差し替えたとき、変えたのは型宣言だけでした。あの差し替えだけで検証まで動くようになったのは、Laravel が引数を型で判断して用意しているからです。

### new ではなく引数で受け取る理由

tinker では `new StatisticsService()` と自分で作りました。同じ `new` を `index()` の中に書いても動きます。2つの書き方を並べます。

```php
// 自分で new して使う（この書き方でも動く）
public function index()
{
    $statisticsService = new StatisticsService();     // 用意する
    $statisticsService->nationalAverageUtilityCost(); // 使う
}

// 引数で受け取って使う（今日書いた形）。用意はサービスコンテナがしている
public function index(StatisticsService $statisticsService)
{
    $statisticsService->nationalAverageUtilityCost(); // 使う
}
```

違いは、**用意する**仕事の置き場所だけです。`new` が1行減ることが目的ではありません。用意する仕事を `index()` の外に出すと、利点が2つ生まれます。

1つ目の利点は、1行目が「このメソッドは何を使うか」の宣言になることです。

```php
// この1行だけで、StatisticsService を使って動くことが分かる
public function index(StatisticsService $statisticsService) {}

// この1行だけで、検証を通った入力を使うことが分かる
public function store(TransactionRequest $request) {}
```

読み取るのは人だけではありません。エディタの補完も、コードを実行せずに間違いを探す検査も、同じ型宣言を読んで動きます。

受け取る場所は、メソッドの引数のほかに、コンストラクタの引数もあります。どちらもサービスコンテナが用意します。

```php
class TransactionController extends Controller
{
    private StatisticsService $statisticsService;

    // インスタンスが作られるときに1回受け取って、プロパティに入れておく
    public function __construct(StatisticsService $statisticsService)
    {
        $this->statisticsService = $statisticsService;
    }

    public function index()
    {
        // どのメソッドからも $this->statisticsService で使える
    }
}
```

こちらは**コンストラクタインジェクション**と呼びます。使うものが増えてくると、クラスの先頭を見るだけで何を使うクラスか分かるので、この形がよく使われます。

2つ目の利点は、渡すものを外から変えられることです。たとえば、e-Stat と通信せずに決まった金額を返す、代わりのクラスを作ったとします。

```php
// StatisticsService の一種として扱われる、通信しない代わりのクラス
class FixedAmountStatisticsService extends StatisticsService
{
    public function nationalAverageUtilityCost(): ?int
    {
        return 19837;
    }
}
```

```php
// サービスコンテナに「StatisticsService の代わりにこちらを渡す」と登録できる。
// そうすると index() は、1文字も変えずに通信しない版で動く
public function index(StatisticsService $statisticsService) {}
```

API につながらない環境で画面側の作業を進めたいときに、この切り替えが使えます。`new` する形では、切り替えのたびに `index()` を書き換えることになります。

コントローラの仕事は、リクエストを受けて結果をビューに渡すことでした。通信を StatisticsService に分けたのと同じ理由で、用意する仕事もコントローラには置かず、サービスコンテナに任せます。

`index()` にとっての StatisticsService のように、動くために必要なものを**依存**と呼びます。依存を自分で `new` せず、外から引数で入れてもらうこの形が**依存注入**（Dependency Injection、DI）です。メソッドインジェクションとコンストラクタインジェクションは、この注入をどちらの引数で受けるかの違いです。

!!! info "ポイント：必要なクラスは引数の型で宣言する"

    自作のクラスも、型を書けば Laravel が作って渡してくれます。引数の型宣言が「このメソッドは何を使うか」の宣言になり、用意する仕事はサービスコンテナが受け持ちます。

## ⑥ 郵便番号から住所を自動で入れる

外部の API を使う場面をもう1つ作ります。郵便番号を入れると住所が自動で入る、通販サイトの会員登録などで見る形の入力欄です。API を呼ぶ処理をサービスクラスに置き、コントローラは引数で受け取る、⑤と同じ形で作ります。

住所の検索には、郵便番号検索 API の zipcloud を使います。キーは要りません。まずブラウザで次の URL を開いてみます。[zipcloud](https://zipcloud.ibsnet.co.jp/doc/api)

```
https://zipcloud.ibsnet.co.jp/api/search?zipcode=1000001
```

```json
{
    "message": null,
    "results": [
        {
            "address1": "東京都",
            "address2": "千代田区",
            "address3": "千代田",
            "kana1": "ﾄｳｷｮｳﾄ",
            "kana2": "ﾁﾖﾀﾞｸ",
            "kana3": "ﾁﾖﾀﾞ",
            "prefcode": "13",
            "zipcode": "1000001"
        }
    ],
    "status": 200
}
```

住所は `results` の1件目に、都道府県（address1）・市区町村（address2）・町域（address3）に分かれて入っています。見つからない郵便番号のときは、`results` が null になります。

画面から作ります。`resources/views/address/index.blade.php` を新規作成します。

```blade
<x-layout>
    <h2>住所の入力</h2>

    <p>
        <label>郵便番号
            <input type="text" id="zipcode" placeholder="1000001">
        </label>
    </p>

    <p>
        <label>住所
            <input type="text" id="address" size="40">
        </label>
    </p>

    <script>
        document.getElementById('zipcode').addEventListener('input', async (event) => {
            const zipcode = event.target.value.replace('-', '');
            if (zipcode.length !== 7) {
                return;
            }

            const response = await fetch(`/v1/zip?code=${zipcode}`);
            const result = await response.json();
            if (result.address !== null) {
                document.getElementById('address').value = result.address;
            }
        });
    </script>
</x-layout>
```

`<script>` の中身は、郵便番号の欄が7桁になったら `/v1/zip?code=郵便番号` を呼び、返ってきた JSON の住所を住所の欄に入れる JavaScript です。`fetch()` は、JavaScript から HTTP リクエストを送る関数です。

ルートを足します。`routes/web.php` の `use` の並びに1行と、ファイルの末尾に次を追加します。

```php
use App\Http\Controllers\AddressController;
```

```php
Route::get('/address', [AddressController::class, 'index']);

Route::prefix('v1')->group(function () {
    Route::get('/zip', [AddressController::class, 'search']);
});
```

コントローラを作ります。`app/Http/Controllers/AddressController.php` を新規作成します。

```php
<?php

namespace App\Http\Controllers;

use App\Services\PostalCodeService;
use Illuminate\Http\Request;

class AddressController extends Controller
{
    /**
     * 住所の入力フォームを表示する。
     */
    public function index()
    {
        return view('address.index');
    }

    /**
     * 郵便番号から住所を検索して、JSON で返す。
     */
    public function search(Request $request, PostalCodeService $postalCodeService)
    {
        return [
            'address' => $postalCodeService->addressByZipCode($request->query('code')),
        ];
    }
}
```

- `search()` は、ビューではなく配列を返しています。コントローラが配列を返すと、Laravel は JSON にして返します。ビューの `fetch()` が受け取るのは、この JSON です。
- `$request->query('code')` は、URL の `?code=...` の値を読みます。zipcloud に `?zipcode=...` を付けて呼んだのと同じ渡し方を、今度は受け取る側で使っています。
- データを返す URL は、画面の URL と分けて、`v1` のグループの下に置きます。`prefix('v1')` で、グループの中のルートの URL の頭に `/v1` が付きます。`v1` はバージョン番号で、API の URL によく使われる形です。グループの書き方は、このファイルの上にある `Route::middleware([...])->group(...)` と同じです。[ルートグループ](https://readouble.com/laravel/13.x/ja/routing.html#route-groups)

!!! success "確認"

    `http://localhost/address` を開いて、郵便番号と住所の欄が表示されれば準備完了です。郵便番号を入れても、住所はまだ入りません。`search()` が受け取る PostalCodeService を、まだ作っていないからです。

!!! question "やってみましょう：PostalCodeService を作る"

    `app/Services/PostalCodeService.php` を新規作成します。⑤の StatisticsService と同じ形です。（　）の3箇所を埋めてください。

    ```php
    <?php

    namespace App\Services;

    use Illuminate\Support\Facades\Http;

    class PostalCodeService
    {
        /**
         * 郵便番号から住所（都道府県・市区町村・町域をつないだ文字列）を返す。
         * 住所を取れなかったときは null。
         */
        public function addressByZipCode(string $zipcode): ?string
        {
            $response = Http::timeout(5)->get('https://zipcloud.ibsnet.co.jp/api/search', [
                'zipcode' => （　）,
            ]);

            $prefecture = $response->json('（　）');
            $city = $response->json('results.0.address2');
            $town = $response->json('results.0.address3');

            if (（　）) {
                return null;
            }

            return $prefecture . $city . $town;
        }
    }
    ```

    確認：`http://localhost/address` の郵便番号に `1000001` と入れて、住所の欄に「東京都千代田区千代田」と入れば成功です。自分の家の郵便番号でも試してみてください。

??? note "答え"

    ```php
    <?php

    namespace App\Services;

    use Illuminate\Support\Facades\Http;

    class PostalCodeService
    {
        /**
         * 郵便番号から住所（都道府県・市区町村・町域をつないだ文字列）を返す。
         * 住所を取れなかったときは null。
         */
        public function addressByZipCode(string $zipcode): ?string
        {
            $response = Http::timeout(5)->get('https://zipcloud.ibsnet.co.jp/api/search', [
                'zipcode' => $zipcode,
            ]);

            $prefecture = $response->json('results.0.address1');
            $city = $response->json('results.0.address2');
            $town = $response->json('results.0.address3');

            if ($prefecture === null) {
                return null;
            }

            return $prefecture . $city . $town;
        }
    }
    ```

    - 1つ目は `$zipcode` です。引数で受け取った郵便番号を、クエリパラメータとして渡します。
    - 2つ目は `results.0.address1` です。応答の `results` の1件目（0番目）の `address1` を指します。
    - 3つ目は `$prefecture === null` です。見つからない郵便番号のときは `results` が null なので、その中を指すパスも null になります。

!!! warning "つまずきポイント：住所が入らない"

    - まず、ブラウザで `http://localhost/v1/zip?code=1000001` を直接開いてみてください。address に住所の文字列が入っていれば（日本語は `\u6771` のような表記で表示されます。JSON の仕様で、正常です）、サービスクラスは動いています。入らないのはビューの貼り間違いです。
    - `Class "App\Services\PostalCodeService" does not exist` が出る：ファイルの置き場所（`app/Services/`）か、`namespace App\Services;`・クラス名の書き間違いです。
    - `{"address":null}` が出る：（　）の埋め方、特に json のパスをもう一度確認してください。

## まとめ

- 集計はクエリメソッド（`whereIn`・`whereBetween`・`sum`）で組み立てて、データベースに計算させる。
- 外部 API は `Http::get()` で呼び出し、`->json('キー.キー')` で値を取り出す。
- API キーは `.env` に置き、`config/estat.php` を経由して `config('estat.app_id')` で読む。`env()` を書くのは config の中だけ。
- 外部との通信はサービスクラスに分けて置く。サービスクラスはただの PHP クラスで、`app/Services/` に手で作る。
- コントローラの引数は、型宣言を見てサービスコンテナが用意している。自作クラスも、Request も、モデルも、同じ仕組みで渡されている。必要なものを自分で `new` せず、引数で受け取る形を依存注入（DI）と呼ぶ。

家計簿は、登録・一覧・編集・削除、操作の結果表示、入力の検証、そして外部データとの比較まで持つアプリになりました。ここまでで完成です。

第1回・第2回では動いているコードを整理する練習をし、第3回からは同じ家計簿を Laravel で作り直して、今日の形まで来ました。

## 時間が余ったら

ここから先は、時間内に終わらなくても構いません。

### 検索条件を呼ぶ側に移す

⑤のサービスクラスは、コントローラにあったコードをそのまま移した形です。動きますが、メソッドは「光熱・水道の全国平均」という1つの用途に固定で、検索条件もクラスの中に埋まっています。役割の線を引き直します。

サービスクラスが受け持つのを、**通信の知識**（どの URL を、どのキーで、どんな形で呼び、応答のどこから値を取るか）だけにします。**何を取るか**（検索条件）は、家計簿側の決めごとなので、呼ぶ側が渡す形にします。

`app/Services/StatisticsService.php` を、次の内容に置き換えます。

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

class StatisticsService
{
    /**
     * 家計調査（e-Stat）から、検索条件に一致する金額（円）を1件取得する。
     * 取れなかったときは null。
     */
    public function fetchAmount(array $searchConditions): ?int
    {
        $query = array_merge([
            'appId' => config('estat.app_id'),
            'statsDataId' => config('estat.stats_data_id'),
        ], $searchConditions);

        $response = Http::timeout(5)->get(config('estat.endpoint'), $query);

        $amount = $response->json('GET_STATS_DATA.STATISTICAL_DATA.DATA_INF.VALUE.$');

        if ($amount === null) {
            return null;
        }

        return (int) $amount;
    }
}
```

`array_merge()` は、2つの配列をつないで1つにする関数です。キーと統計表 ID の手前に、受け取った検索条件をつなげています。

`TransactionController.php` の `index()` が、検索条件を持つ側になります。

=== "書き換える部分"

    ```php
    $utilityCostSearchConditions = [
        'cdTab' => '01',
        'cdCat01' => '107',
        'cdCat02' => '03',
        'cdCat03' => '00',
        'cdArea' => '00000',
        'cdTime' => '2026000606',
    ];

    return view('transactions.index', [
        'transactions' => $transactions,
        'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
        'nationalAverageUtilityCost' => $statisticsService->fetchAmount($utilityCostSearchConditions),
    ]);
    ```

=== "TransactionController.php 全文"

    ```php
    <?php

    namespace App\Http\Controllers;

    use App\Http\Requests\TransactionRequest;
    use App\Models\Category;
    use App\Models\Transaction;
    use App\Services\StatisticsService;

    class TransactionController extends Controller
    {
        /**
         * Display a listing of the resource.
         */
        public function index(StatisticsService $statisticsService)
        {
            $transactions = Transaction::with('category')->latest('occurred_at')->get();

            $utilityCategoryNames = ['電気代', 'ガス代', '水道代'];
            $utilityCategoryIds = Category::whereIn('name', $utilityCategoryNames)->pluck('id');

            $thisMonthUtilityTotal = Transaction::whereIn('category_id', $utilityCategoryIds)
                ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
                ->sum('amount');

            $utilityCostSearchConditions = [
                'cdTab' => '01',
                'cdCat01' => '107',
                'cdCat02' => '03',
                'cdCat03' => '00',
                'cdArea' => '00000',
                'cdTime' => '2026000606',
            ];

            return view('transactions.index', [
                'transactions' => $transactions,
                'thisMonthUtilityTotal' => $thisMonthUtilityTotal,
                'nationalAverageUtilityCost' => $statisticsService->fetchAmount($utilityCostSearchConditions),
            ]);
        }

        /**
         * Show the form for creating a new resource.
         */
        public function create()
        {
            return view('transactions.create', [
                'categories' => Category::all(),
            ]);
        }

        /**
         * Store a newly created resource in storage.
         */
        public function store(TransactionRequest $request)
        {
            $validated = $request->validated();

            Transaction::create($validated);

            return redirect('/transactions')->with('message', '登録しました');
        }

        /**
         * Display the specified resource.
         */
        public function show(Transaction $transaction)
        {
            //
        }

        /**
         * Show the form for editing the specified resource.
         */
        public function edit(Transaction $transaction)
        {
            return view('transactions.edit', [
                'transaction' => $transaction,
                'categories' => Category::all(),
            ]);
        }

        /**
         * Update the specified resource in storage.
         */
        public function update(TransactionRequest $request, Transaction $transaction)
        {
            $validated = $request->validated();

            $transaction->update($validated);

            return redirect('/transactions')->with('message', '更新しました');
        }

        /**
         * Remove the specified resource from storage.
         */
        public function destroy(Transaction $transaction)
        {
            $transaction->delete();

            return redirect('/transactions')->with('message', '削除しました');
        }
    }
    ```

!!! success "確認"

    一覧をリロードして、表示が変わらなければ成功です。別の統計が欲しくなったときは、条件を変えて `fetchAmount()` を呼ぶだけになりました。

### 型の間違いを Larastan に探させる

このプロジェクトには、コードを実行せずに型の問題を探す [Larastan](https://github.com/larastan/larastan) が最初から入っています。設定はプロジェクト直下の `phpstan.neon` にあります。開くと `level: 7` の行があります。レベルは検査の厳しさです。まず 5 に下げます。

```yaml
    level: 5
```

実行します。

```sh
./vendor/bin/sail php vendor/bin/phpstan analyse --memory-limit=2G
```

```
Note: Using configuration file /var/www/html/phpstan.neon.
 41/41 [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%

 ------ -------------------------------------------------------------------
  Line   app/Http/Controllers/TransactionController.php
 ------ -------------------------------------------------------------------
  17     Relation 'category' is not found in App\Models\Transaction model.
         🪪  larastan.relationExistence
 ------ -------------------------------------------------------------------


 [ERROR] Found 1 error
```

指摘は1件で、「Transaction モデルに category というリレーションが見つからない」。①から使ってきた `with('category')` の行です。実際には動いているのに、Larastan には見えていません。`category()` メソッドに戻り値の型が書かれていないためです。`app/Models/Transaction.php` に型を書きます。

=== "書き換える部分"

    `use` を1行足し、`category()` に戻り値の型を書きます。

    ```php
    use Illuminate\Database\Eloquent\Relations\BelongsTo;
    ```

    ```php
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }
    ```

=== "Transaction.php 全文"

    ```php
    <?php

    namespace App\Models;

    use Illuminate\Database\Eloquent\Factories\HasFactory;
    use Illuminate\Database\Eloquent\Model;
    use Illuminate\Database\Eloquent\Relations\BelongsTo;

    class Transaction extends Model
    {
        use HasFactory;

        protected $fillable = ['category_id', 'type', 'amount', 'occurred_at', 'note'];

        public function category(): BelongsTo
        {
            return $this->belongsTo(Category::class);
        }
    }
    ```

もう一度実行します。

```sh
./vendor/bin/sail php vendor/bin/phpstan analyse --memory-limit=2G
```

```
Note: Using configuration file /var/www/html/phpstan.neon.
 41/41 [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%


 [OK] No errors
```

!!! success "確認"

    `[OK] No errors` が出れば成功です。

!!! info "ポイント：型宣言は機械の検査にも使われる"

    型宣言は、読む人のためだけのものではありません。書いてあれば、Larastan がリレーションの存在や `with('category')` の綴りまで検査してくれます。第1回に ESLint が JavaScript でしていたことを、PHP では Larastan がします。

`level: 7` に戻すと、指摘が増えます。ほとんどは「メソッドに戻り値の型が無い」で、1つずつ型を書けば減らせます。授業のあとの題材にしてください。

### 前回の続き

前回の資料の「時間が余ったら」（日付の `$casts`・アクセサ・ページ送りなど）も、この家計簿にそのまま足せます。

## 授業のあとに試すこと

- **電気・ガス・水道の内訳を出す**：検索条件の `cdCat01` を `108`（電気代）・`109`（ガス代）・`111`（上下水道料）に変えて1件ずつ取ると、内訳が取れます（2026年6月の全国平均は、電気代 9,948円・ガス代 4,233円・上下水道料 5,269円）。
- **世帯人数で比べる**：検索条件の `cdCat03` は世帯人員の指定です。`00`（平均）のほかに、`01`（2人）〜`05`（6人以上）があります。自分の世帯に合わせて変えると、比較が実態に近づきます。
- **自分の API キーを取る**：appId は [e-Stat の利用登録](https://www.e-stat.go.jp/api/) で無料で発行できます。`.env` のキーを自分のものに差し替えれば、このアプリは自分のキーだけで動きます。
