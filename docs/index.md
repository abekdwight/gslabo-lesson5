# Laravel 3 — 家計簿を全国平均と比べる

## 前回のおさらいと、今回のゴール

前回は、編集と削除を作って家計簿の操作をそろえました。あわせて、フラッシュメッセージ・FormRequest・エラーメッセージの日本語化で、フォームまわりを整えました。今日はその続きで、この講座の最終回です。

ゴールは、一覧の上に「今月の光熱費」と「全国平均」を並べて表示することです。

```
今月の光熱費　合計 ¥12,280 ／ 全国平均 ¥19,837 ／ 差 ¥-7,557
```

自分の合計は家計簿のデータベースから集計し、全国平均は政府統計（e-Stat）の API から取得します。家計簿が、外部のサービスと通信するアプリになります。

## 今日学ぶこと

| 言葉                                     | ざっくり言うと                                                       | 登場する場面 |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------ |
| **クエリメソッド（whereIn / sum など）** | 検索や集計の条件を組み立てて、データベースに計算させる書き方         | ①            |
| **HTTP クライアント（Http）**            | PHP のコードから外部の URL を呼び出す機能                            | ②            |
| **.env と config**                       | API キーのような、コードに直接書かない値の置き場所                   | ③            |
| **サービスクラス**                       | コントローラから処理を分けて置く、自作の PHP クラス                  | ④            |
| **サービスコンテナ**                     | 型宣言されたクラスのインスタンスを作って渡す、Laravel の仕組み       | ④            |
| **メソッドインジェクション**             | メソッドの引数に型を書いて、サービスコンテナから受け取る書き方       | ④            |

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

## 進め方

5つのステップで進めます。

1. 今月の光熱費を合計する
2. 統計 API を呼び出してみる
3. API キーを .env と config に置く
4. サービスクラスを作って、コントローラで受け取る
5. 全国平均との差を表示する

①で自分の合計、②〜④で全国平均、⑤で差を出します。

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
Transaction::whereIn('category_id', $utilityCategoryIds)
    ->whereBetween('occurred_at', [now()->startOfMonth()->format('Y-m-d'), now()->endOfMonth()->format('Y-m-d')])
    ->sum('amount');
```

```
[!] Aliasing 'Transaction' to 'App\Models\Transaction' for this Tinker session.
= 12280
```

表示される金額は、登録した内容によって変わります。

- `whereBetween('occurred_at', [開始, 終了])` は「この範囲に入る」条件です。`now()` は現在日時で、`startOfMonth()` と `endOfMonth()` で今月の初日と末日にできます。
- `sum('amount')` は、条件に合った行の `amount` を合計します。
- メソッドをつなぐたびに問い合わせの条件が組み上がり、`sum()` などを呼んだ時点で SQL が実行されます。計算するのはデータベースで、PHP 側にループは書きません。[クエリビルダ](https://readouble.com/laravel/13.x/ja/queries.html)

これをコントローラに置きます。`app/Http/Controllers/TransactionController.php` の `index()` を書き換えます。

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

一覧の上に表示します。`resources/views/transactions/index.blade.php` の `<table>` の上に追加します。

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

!!! success "確認"

    一覧の上に「今月の光熱費」と、いま登録した金額の合計が表示されれば成功です。

!!! warning "つまずきポイント：合計が出ない"

    - `Undefined variable $thisMonthUtilityTotal`：コントローラでビューに渡す配列のキー名と、ビューの変数名がそろっているか確認してください。
    - 合計が 0 円になる：登録した取引の日付が今月になっているか、カテゴリが「電気代」「ガス代」「水道代」になっているかを一覧で確認してください。

## ② 統計 API を呼び出してみる

比べる相手の全国平均は、政府統計の総合窓口（e-Stat）の API から取得します。家計調査という統計に、二人以上の世帯が1ヶ月に払う「光熱・水道」の平均額があります。

API は、プログラムから呼び出すための URL です。開くと、HTML の画面ではなくデータ（JSON）が返ります。まずブラウザで開いてみます。次の URL の `（共有されたキー）` を、共有された appId に置き換えて開いてください。

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

## ③ API キーを .env と config に置く

②では、キーを tinker に直接貼り付けました。アプリのコードで同じことをすると、キーがファイルに残り、Git に入って公開されてしまいます。キーのような秘密の値は、コードではなく `.env` に置きます。

`.env` は前回、`APP_LOCALE=ja` で書き換えたファイルです。末尾に1行追加します。

```
ESTAT_APP_ID=（共有されたキー）
```

`=` の前後にスペースは入れません。`.env` が Git に入らないことは、`.gitignore` を開くと確認できます。`.env` の行があり、コミットの対象から外れています。

!!! warning "注意：キーの扱い"

    appId は、コードや GitHub に書かないでください。置き場所は `.env` だけです。

次に、コードから読むための設定ファイルを作ります。`config/estat.php` を新規作成します。

```php
<?php

return [
    'app_id' => env('ESTAT_APP_ID'),
    'endpoint' => 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData',
    'stats_data_id' => '0002070008',
];
```

`config/` のファイルは、配列を return するだけの PHP ファイルです。ファイル名とキーをつないで、`config('estat.app_id')` のように読めます。`env('ESTAT_APP_ID')` は `.env` の値を読む関数です。前回、`config/app.php` の中に `'locale' => env('APP_LOCALE', 'en')` と書かれているのを見ました。今回は、同じ形を自分で書きます。

URL と統計表 ID もここに置きました。キーと違って秘密ではありませんが、「どの API をどう呼ぶか」という設定値は、処理のコードと分けて1箇所に集めます。

!!! info "ポイント：env() を書くのは config の中だけ"

    アプリのコード（コントローラや、この後作るサービスクラス）からは、`env()` ではなく `config()` で読みます。本番環境には設定を1つにまとめて読み込む機能があり、その状態では `env()` が値を返さなくなるためです。`.env` の値は config だけが読み、アプリのコードは `config()` で読む。この形にしておけば、この問題は起きません。[設定](https://readouble.com/laravel/13.x/ja/configuration.html)

tinker で読めることを確認します。`.env` と config の変更は開いたままの tinker に反映されないので、`exit` で終了してから開き直してください。

```sh
./vendor/bin/sail artisan tinker
```

```php
config('estat.app_id');
```

```
= "（共有されたキーが表示される）"
```

!!! success "確認"

    共有されたキーがそのまま表示されれば成功です。

!!! warning "つまずきポイント：null が返る"

    - tinker を開き直したか確認してください。開いたままの tinker は、変更前の値を持っています。
    - `.env` の行が `ESTAT_APP_ID=キー` の形になっているか（スペースや引用符が入っていないか）確認してください。
    - それでも直らないときは、`./vendor/bin/sail artisan config:clear` を実行してから、もう一度 tinker を開いてください。

## ④ サービスクラスを作って、コントローラで受け取る

②の呼び出しを、アプリに組み込みます。置き場所はコントローラではありません。外部のサービスとの通信は、コントローラに直接書かず、通信だけを受け持つクラスに分けて置くのが定石です。コントローラの仕事はリクエストを受けて結果をビューに渡すことで、どの URL をどんなパラメータで呼ぶかは、別の関心事だからです。この形のクラスを**サービスクラス**と呼びます。

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

中身は②で tinker に打った呼び出しと同じで、違いは次の4つです。

- キーと URL と統計表 ID は、③で作った config から読んでいます。
- `timeout(5)` を足しました。相手が応答しないとき、5秒で打ち切る指定です。
- 戻り値の型を `?int` と宣言しました。「int または null」という意味です。応答に金額が無いとき（キーの間違い、API 側の障害など）、`json('...')` は null を返すので、それをそのまま null として返します。
- 金額は文字列で返ってくるので、`(int)` で整数にしています。

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

`TransactionController.php` を書き換えます。`use` を1行足し、`index()` の引数と、ビューに渡す配列に1行を足します。

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

一覧に全国平均を足します。`index.blade.php` の「今月の光熱費」の段落を書き換えます。

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

!!! success "確認"

    一覧の上に「合計 ¥…… ／ 全国平均 ¥……」と並べば成功です。

!!! warning "つまずきポイント：全国平均が出ない"

    - 合計だけが表示される：平均が null になっています。tinker で③の `config('estat.app_id')` と④の `nationalAverageUtilityCost()` をもう一度実行して、どちらで null になるかを切り分けてください。②のつまずきポイント（`RESULT` の見方）も使えます。
    - `Class "App\Services\StatisticsService" does not exist`：コントローラの `use App\Services\StatisticsService;` の書き忘れか、ファイルの置き場所・`namespace App\Services;` の書き間違いです。

### 引数は Laravel が用意している

`$statisticsService` には、StatisticsService のインスタンスが入っていました。`new` を書いたのは tinker の中だけで、コントローラには型宣言しかありません。

Laravel は、コントローラのメソッドを呼ぶ前に引数の型宣言を見て、必要なものを用意してから呼び出します。今日の StatisticsService だけでなく、これまで書いてきた引数も、この仕組みで渡されていました。

| 引数の書き方                                        | Laravel が用意するもの                                                       | 書いた場所                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `StatisticsService $statisticsService`              | 新しく作ったインスタンス                                                     | 今日の `index()`                           |
| `Request $request`                                  | 処理中のリクエスト                                                           | 前々回の `store()`                         |
| `TransactionRequest $request`                       | 作って、`rules()` の検証を通してから渡す。失敗したらメソッドは呼ばれない     | 前回の `store()`・`update()`               |
| `Transaction $transaction`（URL の `{transaction}` と同名） | データベースから探した1件。見つからなければ 404                       | 前回の `edit()`・`update()`・`destroy()`   |

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

引数の並びは、**用意してもらうものを前に、URL の `{}` に対応するものを後に**書きます。`update(TransactionRequest $request, Transaction $transaction)` は、この並びです。

!!! info "ポイント：必要なクラスは引数の型で宣言する"

    自作のクラスも、型を書けば Laravel が作って渡してくれます。サービスクラスが増えても、コントローラに `new` を並べる必要はありません。

## ⑤ 全国平均との差を表示する

最後の1行は、自分で書いてみてください。

!!! question "やってみましょう：差を表示する"

    `index.blade.php` の全国平均の行の下（`@if` の中）に、次の1行を足します。（　）の2箇所を埋めてください。自分の合計が平均より少なければ、マイナスの金額になる引き算です。

    ```blade
    ／ 差 ¥{{ number_format(（　） - （　）) }}
    ```

    確認：一覧の上に「合計 ¥12,280 ／ 全国平均 ¥19,837 ／ 差 ¥-7,557」のように3つ並べば成功です。

??? note "答え"

    ```blade
    ／ 差 ¥{{ number_format($thisMonthUtilityTotal - $nationalAverageUtilityCost) }}
    ```

    自分の合計から平均を引きます。マイナスなら平均より少なく、プラスなら平均より多く使っています。

    === "index.blade.php 全文"

        ```blade
        <x-layout>
            <h2>今月の光熱費</h2>
            <p>
                合計 ¥{{ number_format($thisMonthUtilityTotal) }}
                @if ($nationalAverageUtilityCost !== null)
                    ／ 全国平均 ¥{{ number_format($nationalAverageUtilityCost) }}
                    ／ 差 ¥{{ number_format($thisMonthUtilityTotal - $nationalAverageUtilityCost) }}
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

全国平均は統計の集計月、自分の合計は今月なので、月がずれた比較です。それでも「自分の光熱費は平均とどのくらい違うか」の目安には十分です。

## まとめ

- 集計はクエリメソッド（`whereIn`・`whereBetween`・`sum`）で組み立てて、データベースに計算させる。
- 外部 API は `Http::get()` で呼び出し、`->json('キー.キー')` で値を取り出す。
- API キーは `.env` に置き、`config/estat.php` を経由して `config('estat.app_id')` で読む。`env()` を書くのは config の中だけ。
- 外部との通信はサービスクラスに分けて置く。サービスクラスはただの PHP クラスで、`app/Services/` に手で作る。
- コントローラの引数は、型宣言を見てサービスコンテナが用意している。自作クラスも、Request も、モデルも、同じ仕組みで渡されている。

家計簿は、登録・一覧・編集・削除、操作の結果表示、入力の検証、そして外部データとの比較まで持つアプリになりました。ここまでで完成です。

第1回・第2回では動いているコードを整理する練習をし、第3回からは同じ家計簿を Laravel で作り直して、今日の形まで来ました。

## 時間が余ったら

ここから先は、時間内に終わらなくても構いません。

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

- **電気・ガス・水道の内訳を出す**：`cdCat01` を `108,109,111`（電気代・ガス代・上下水道料）にすると、`VALUE` が3件の配列で返ります（2026年6月の全国平均は、電気代 9,948円・ガス代 4,233円・上下水道料 5,269円）。1件のときと形が変わるので、tinker で `VALUE` までを取り出して、`@cat01` ごとの金額を取り出してみてください。
- **世帯人数で比べる**：`cdCat03` は世帯人員の指定です。`00`（平均）のほかに、`01`（2人）〜`05`（6人以上）があります。自分の世帯に合わせて変えると、比較が実態に近づきます。
- **自分の API キーを取る**：appId は [e-Stat の利用登録](https://www.e-stat.go.jp/api/) で無料で発行できます。`.env` のキーを自分のものに差し替えれば、このアプリは自分のキーだけで動きます。
