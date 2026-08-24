<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class TransactionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'occurred_at' => 'required|date',
            'type' => 'required|in:income,expense',
            'category_id' => 'required|exists:categories,id',
            'amount' => 'required|integer|min:1',
            'note' => 'nullable|string|max:255',
        ];
    }

    public function attributes(): array
    {
        return [
            'occurred_at' => '日付',
            'type' => '区分',
            'category_id' => 'カテゴリ',
            'amount' => '金額',
            'note' => 'メモ',
        ];
    }
}
