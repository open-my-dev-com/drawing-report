# Writing Formulas and Function Reference

[한국어](formula.md) · [日本語](formula.ja.md)

SlipKit formulas compute values entered into a template, convert them into display formats, and determine whether conditional formats apply.

You can use formulas for the displayed values of fields, grid cells, and barcodes, and for conditional formats on text, fields, and grid cells. They handle tasks such as the following.

- Summing amounts per line item
- Computing an amount from quantity and unit price
- Showing text depending on a condition
- Changing the display format of numbers and dates
- Computing VAT
- Adding dates and computing periods

This document explains the formula-writing rules and the 32 built-in functions SlipKit provides.

> [!NOTE]
> SlipKit formulas do not execute JavaScript code.
> Only the registered operators and functions are interpreted by its own formula engine.

## Where formulas can be written

| Location | Values the formula can reference | Usage example |
|---|---|---|
| Field | All values of the voucher | Totals, tax, display text |
| Barcode | All values of the voucher | Composing an order number, generating a barcode value |
| Grid cell outside the data repeat area | All values of the voucher | Total at the bottom of the table |
| Grid cell inside the data repeat area | All values of the voucher and the current repeat item | Per-row amount computation |
| Conditional format on text, a field, or a cell outside the data repeat area | All values of the voucher | Highlighting a negative amount or a specific status |
| Conditional format on a cell inside the data repeat area | All values of the voucher and the current repeat item | Highlighting matching rows |

Select a field, barcode, or grid cell and change the value type to <kbd>Formula</kbd> to enter a formula.

Conditional-format conditions use the same syntax and functions, but must return a boolean. Select text, a field, or a grid cell and enter the condition under <kbd>Conditional format</kbd>.

![Formula editor](images/en/formula.png)

The formula editor provides the following features.

- Inserting parameters and list fields
- Checking the supported functions
- Checking syntax errors
- Checking the computed result using sample values

For display formulas, see [Writing formulas](designer.en.md#7-writing-formulas) in the Form Designer Usage Guide. For conditions, see [Setting conditional formats](designer.en.md#8-setting-conditional-formats).

## Quick start

Assume you have the following voucher values.

```json
{
  "customerName": "Hanbit Trading",
  "shippingFee": 3000,
  "items": [
    {
      "name": "Copy paper",
      "quantity": 2,
      "unitPrice": 5000,
      "amount": 10000
    },
    {
      "name": "Ballpoint pen",
      "quantity": 3,
      "unitPrice": 1000,
      "amount": 3000
    }
  ]
}
```

Sum all line-item amounts.

```text
SUM(items.amount)
→ 13000
```

Compute the total including the shipping fee.

```text
SUM(items.amount) + shippingFee
→ 16000
```

Build display text.

```text
CONCAT(customerName, " Co.")
→ "Hanbit Trading Co."
```

Apply a thousands separator to the total.

```text
CONCAT(FORMAT_NUMBER(SUM(items.amount) + shippingFee), " KRW")
→ "16,000 KRW"
```

Inside a repeat grid, you can reference the current item's fields directly by name.

```text
quantity * unitPrice
```

> [!IMPORTANT]
> Inside the data repeat area, the current item's fields take precedence over top-level voucher values of the same name.
> The whole list can still be referenced as `items.amount` as before.

### Calculation scopes in repeating grids

Formulas in row bands can select a calculation scope with an `@` reserved reference.

| Reference | Scope | Example |
|---|---|---|
| `@item` | Current item | `@item.amount` |
| `@group` | Items in the current group | `SUM(@group.amount)` |
| `@page` | Items on the current output page | `SUM(@page.amount)` |
| `@carried` | Items placed before the current output page | `SUM(@carried.amount)` |
| `@all` | All items included in the output | `SUM(@all.amount)` |

Blank items are excluded from these scopes. When <kbd>Maximum items</kbd> is set, `@all` contains only the items left after that limit is applied.

The designer's <kbd>Group subtotal</kbd>, <kbd>Page subtotal</kbd>, and <kbd>Final total</kbd> quick setup commands create `@group`, `@page`, and `@all` formulas respectively. Reserved references are available in repeating-grid rows for which the output plan supplies that scope.

## Formula-writing rules

### Values and references

| Kind | How to write | Example |
|---|---|---|
| Number | Write the number as-is | `1500`, `-3.5`, `1e3` |
| String | Wrap in double quotes | `"Done"` |
| Boolean | `TRUE` or `FALSE` | `TRUE` |
| Parameter | Write the parameter key | `totalAmount` |
| Sub-field | Join the path with a dot | `customer.name` |
| List range | Join the list and a sub-field | `items.amount` |

To include a double quote inside a string, write the double quote twice.

```text
"Han ""bit"""
→ Han "bit"
```

Parameter and field names must follow these rules to be referenceable in a formula.

- Start with a letter or an underscore (`_`)
- After that, letters, digits, and underscores can be used
- Unicode characters, including Korean, can be used
- Spaces, hyphens (`-`), and special characters cannot be used

```text
totalAmount     valid
총금액           valid
_item1          valid
item-price      cannot be used as a formula reference name
1stItem         cannot be used because it starts with a digit
```

> [!TIP]
> If you use only Latin and Korean letters, digits, and underscores from the moment you create a template parameter, you can prevent formula-reference problems.

### Operators

| Category | Operator | Description |
|---|---|---|
| Arithmetic | `+` | Addition |
| Arithmetic | `-` | Subtraction or negative sign |
| Arithmetic | `*` | Multiplication |
| Arithmetic | `/` | Division |
| Comparison | `=` | Equal |
| Comparison | `<>` | Not equal |
| Comparison | `<` | Less than |
| Comparison | `>` | Greater than |
| Comparison | `<=` | Less than or equal |
| Comparison | `>=` | Greater than or equal |

The operation precedence is as follows.

1. Parentheses
2. Unary sign `+`, `-`
3. Multiplication and division
4. Addition and subtraction
5. Comparison

```text
1 + 2 * 3
→ 7

(1 + 2) * 3
→ 9
```

> [!IMPORTANT]
> `+` is only for numeric addition.
> To join strings, use `CONCAT`.

### Value types

SlipKit formula values are distinguished into the following five types.

- Number
- String
- Boolean
- Empty value
- Range

Operations or functions that require a number do not automatically convert a string to a number.

```text
amount * 2
```

If `amount` is the string `"1500"`, the formula above throws an error. You must convert it explicitly.

```text
TO_NUMBER(amount) * 2
→ 3000
```

Ordinary comparison operations compare values of the same type.

```text
3 = 3
→ TRUE

3 = "3"
→ FALSE

TO_STRING(3) = "3"
→ TRUE
```

The `<`, `>`, `<=`, `>=` comparisons can only be used between numbers or between strings.

> [!NOTE]
> The condition strings of `SUMIF` and `COUNTIF` use condition-comparison rules separate from ordinary comparison operations.
> A condition string that can be interpreted as a number can be compared with a numeric value.

### Empty values

A non-existent parameter or a reference with no assigned value is treated as an empty value.

An empty value is handled differently depending on where it is used.

| Where used | Handling |
|---|---|
| Arithmetic operation | `0` |
| `SUM`, `AVG`, `MIN`, `MAX` | Excluded from aggregation |
| `COUNT` | Excluded from the count |
| `CONCAT`, `TO_STRING` | Empty string |
| Condition | False |
| Ordinary comparison | Not equal to a value of a different type |

The empty string `""` is excluded from aggregation functions, but using it directly in an arithmetic operation throws an error.

> [!CAUTION]
> A non-existent parameter also becomes an empty value, so a misspelled name does not always cause a syntax error.
> Check the result with the designer's sample data.

### Range

Referencing a sub-field of a list parameter creates a range.

```text
items.amount
```

A range can be passed to aggregation functions such as `SUM`, `AVG`, `COUNT`, `MIN`, `MAX`, `SUMIF`, and `COUNTIF`.

```text
SUM(items.amount)
```

A range cannot be used directly in an arithmetic operation.

```text
items.amount + 1000
→ error
```

You must use an aggregation function.

```text
SUM(items.amount) + 1000
```

If a list item does not have the given field, that item's value is treated as an empty value.

## Functions at a glance

| Category | Functions |
|---|---|
| Aggregation | `SUM`, `AVG`, `COUNT`, `MIN`, `MAX` |
| Conditional aggregation | `SUMIF`, `COUNTIF` |
| Arithmetic | `ROUND`, `FLOOR`, `CEIL`, `ABS` |
| String | `CONCAT`, `LEFT`, `RIGHT`, `MID`, `REPLACE`, `TRIM`, `UPPER`, `LOWER` |
| Condition | `IF`, `AND`, `OR` |
| Display format | `FORMAT_NUMBER`, `FORMAT_DATE`, `NUMBER_TO_KOREAN` |
| Date | `TODAY`, `DATE_ADD`, `DATE_DIFF` |
| Tax | `VAT` |
| Type conversion | `TO_NUMBER`, `TO_STRING`, `TO_DATE` |

Function names are case-insensitive.

```text
SUM(items.amount)
sum(items.amount)
```

Both formulas are treated as the same function.

An unregistered function is rejected at the syntax-analysis stage.

## Aggregation functions

### `SUM`

`SUM(value, ...)`

Computes the sum of numbers and ranges. You can pass multiple values and ranges together.

Empty values and empty strings are excluded. If the aggregation target contains a non-number value, an error occurs.

```text
SUM(items.amount)
→ the sum of item amounts

SUM(items.amount, shippingFee)
→ the sum of item amounts + the shipping fee

SUM()
→ 0
```

### `AVG`

`AVG(value, ...)`

Computes the average of numbers and ranges.

Empty values and empty strings are excluded, and if there is not a single number to average, an error occurs.

```text
AVG(items.unitPrice)
```

### `COUNT`

`COUNT(value, ...)`

Returns the number of items excluding empty values and empty strings.

Not only numbers but also strings and booleans are included in the count if they have a value.

```text
COUNT(items.name)
→ the number of items with a product name entered
```

### `MIN`

`MIN(value, ...)`

Returns the smallest number. If there is no number to compute, it returns `0`.

```text
MIN(items.unitPrice)
```

### `MAX`

`MAX(value, ...)`

Returns the largest number. If there is no number to compute, it returns `0`.

```text
MAX(items.amount)
```

## Conditional aggregation functions

### `SUMIF`

`SUMIF(conditionRange, condition, sumRange?)`

Sums only the items that match the condition.

If the sum range is omitted, it sums the values of the condition range.

```text
SUMIF(items.category, "Food", items.amount)
→ the sum of amount for items whose category is "Food"

SUMIF(items.amount, ">=10000")
→ the sum of amount that is 10000 or more
```

When the condition range and sum range are used together, an error occurs if the two ranges have different lengths.

Empty values and empty strings in the sum target are excluded. If a matching sum target is not a number, an error occurs.

### `COUNTIF`

`COUNTIF(range, condition)`

Returns the number of items that match the condition.

```text
COUNTIF(items.status, "Done")
→ the number of items whose status is "Done"

COUNTIF(items.quantity, ">4")
→ the number of items whose quantity is greater than 4
```

### Condition strings

`SUMIF` and `COUNTIF` support the following condition strings.

| Condition | Meaning |
|---|---|
| `"Food"` | Equal to `"Food"` |
| `"=Food"` | Equal to `"Food"` |
| `"<>Done"` | Not equal to `"Done"` |
| `">=10"` | 10 or more |
| `">10"` | Greater than 10 |
| `"<=10"` | 10 or less |
| `"<10"` | Less than 10 |

A condition without a comparison operator is treated as an equality comparison.

A numeric comparison condition works only when the comparison operand of the condition string can be interpreted as a number.

```text
COUNTIF(items.quantity, "3")
COUNTIF(items.quantity, "=3")
```

Both formulas can count items with the number `3`.

> [!CAUTION]
> A `"<>"` condition judges an empty value to also be different from the specified value.
> For example, `COUNTIF(items.status, "<>Done")` includes items whose status is empty.

## Arithmetic functions

### `ROUND`

`ROUND(number, digits?)`

Rounds to the specified number of digits. If digits is omitted, it rounds to an integer.

Digits must be an integer, and specifying a negative number rounds to tens, hundreds, or thousands.

```text
ROUND(1234.567, 2)
→ 1234.57

ROUND(1234.567)
→ 1235

ROUND(1234.567, -2)
→ 1200
```

### `FLOOR`

`FLOOR(number, digits?)`

Rounds down toward the smaller value at the specified digits.

```text
FLOOR(1234.567, 1)
→ 1234.5

FLOOR(-15, -1)
→ -20
```

### `CEIL`

`CEIL(number, digits?)`

Rounds up toward the larger value at the specified digits.

```text
CEIL(1234.001, 2)
→ 1234.01
```

### `ABS`

`ABS(number)`

Returns the absolute value of a number.

```text
ABS(-500)
→ 500
```

## String functions

### `CONCAT`

`CONCAT(value, ...)`

Converts multiple values to strings and joins them.

Numbers and booleans are converted to strings, and empty values are treated as empty strings. Ranges cannot be joined directly.

```text
CONCAT("Total: ", 1000, " KRW")
→ "Total: 1000 KRW"

CONCAT(customerName, " Co.")
→ "Hanbit Trading Co."
```

### `LEFT`

`LEFT(string, count?)`

Returns the given number of characters from the left of the string. If the count is omitted, it returns one character.

If the count is `0` or less, it returns an empty string.

```text
LEFT("Statement", 4)
→ "Stat"
```

### `RIGHT`

`RIGHT(string, count?)`

Returns the given number of characters from the right of the string. If the count is omitted, it returns one character.

If the count is `0` or less, it returns an empty string.

```text
RIGHT("Statement", 3)
→ "ent"
```

### `MID`

`MID(string, start, length)`

Returns a part of the string from the given start position. The start position is counted from `1`.

The start position must be an integer of 1 or more. If the length is `0` or less, it returns an empty string.

```text
MID("Statement", 6, 4)
→ "ment"
```

### `REPLACE`

`REPLACE(string, find, replacement)`

Replaces all matching strings.

```text
REPLACE("2026-08-25", "-", "/")
→ "2026/08/25"
```

If the find string is empty, it returns the original string as-is.

### `TRIM`

`TRIM(string)`

Removes whitespace at the front and back of the string. Whitespace in the middle is kept.

```text
TRIM("  Hanbit Trading  ")
→ "Hanbit Trading"
```

### `UPPER`

`UPPER(string)`

Converts Latin letters to uppercase.

```text
UPPER("slip-001")
→ "SLIP-001"
```

### `LOWER`

`LOWER(string)`

Converts Latin letters to lowercase.

```text
LOWER("SLIP-001")
→ "slip-001"
```

## Condition functions

### `IF`

`IF(condition, whenTrue, whenFalse?)`

Returns the second argument if the condition is true, and the third argument if it is false.

If the false value is omitted, it returns an empty value when the condition is false.

```text
IF(totalAmount >= 100000, "Bulk", "Regular")

IF(isPaid, "Payment complete")
```

`IF` computes only the selected result. It does not evaluate the formula on the unused side.

```text
IF(quantity = 0, 0, amount / quantity)
```

If the quantity is `0`, the division is not performed, so a division-by-zero error does not occur.

### `AND`

`AND(condition, ...)`

Returns `TRUE` if all conditions are true. If even one is false, it returns `FALSE` without evaluating the remaining conditions.

At least one condition is required.

```text
AND(quantity > 0, unitPrice > 0)
```

### `OR`

`OR(condition, ...)`

Returns `TRUE` if at least one condition is true. When it meets a true condition, it does not evaluate the remaining conditions.

At least one condition is required.

```text
OR(status = "Done", status = "Issued")
```

A condition can use a boolean or a number.

- `TRUE` is true
- `FALSE` is false
- `0` is false
- A nonzero number is true
- An empty value is false

Strings and ranges cannot be used directly as conditions.

## Display format functions

### `FORMAT_NUMBER`

`FORMAT_NUMBER(number, decimals?)`

Applies a locale-specific thousands-separator format to a number and returns a string.

```text
FORMAT_NUMBER(1234567)
→ "1,234,567"

FORMAT_NUMBER(1234.5, 2)
→ "1,234.50"
```

If you specify the number of decimals, it displays fixed to that number of decimal places. The range you can specify is `0` to `20`.

The display result follows the `locale` setting of the formula evaluation context. If `locale` is not specified, `en-US` is used.

For example, in `de-DE` it is displayed as follows.

```text
FORMAT_NUMBER(1234.5)
→ "1.234,5"
```

For how to set the locale, see the [Configuration Guide](configuration.en.md#ui-language-setting).

### `FORMAT_DATE`

`FORMAT_DATE(date, pattern?)`

Converts a date into the specified pattern and returns a string. If the pattern is omitted, the `YYYY-MM-DD` format is used.

```text
FORMAT_DATE("2026-08-25")
→ "2026-08-25"

FORMAT_DATE("2026-08-25", "M/D/YYYY")
→ "8/25/2026"
```

The supported pattern tokens are as follows.

| Token | Meaning | Example |
|---|---|---|
| `YYYY` | Four-digit year | `2026` |
| `YY` | Two-digit year | `26` |
| `MM` | Two-digit month | `08` |
| `M` | Month | `8` |
| `DD` | Two-digit day | `05` |
| `D` | Day | `5` |
| `HH` | Two-digit hour | `09` |
| `mm` | Two-digit minute | `30` |
| `ss` | Two-digit second | `00` |

Dates and times are handled in UTC.

A date that does not actually exist is not auto-corrected but treated as an error.

```text
FORMAT_DATE("2026-02-30")
→ error
```

### `NUMBER_TO_KOREAN`

`NUMBER_TO_KOREAN(integer)`

Converts an integer into a string usable for Korean amount notation.

It does not omit the `일` before 십, 백, or 천.

```text
NUMBER_TO_KOREAN(0)
→ "영"

NUMBER_TO_KOREAN(110)
→ "일백일십"

NUMBER_TO_KOREAN(123456)
→ "일십이만삼천사백오십육"

NUMBER_TO_KOREAN(-3000)
→ "마이너스삼천"
```

Only integers are supported, and a value beyond JavaScript's safe integer range is treated as an error.

When building an amount phrase, you can combine it as follows.

```text
CONCAT("금 ", NUMBER_TO_KOREAN(totalAmount), " 원")
```

## Date functions

Date functions use ISO-format date strings.

```text
"2026-08-25"
"2026-08-25T09:30:00Z"
```

Date computation is performed in UTC. If a specific region's date matters for your business, we recommend building a `YYYY-MM-DD` value in your application and passing it as a parameter.

### `TODAY`

`TODAY()`

Returns the current UTC date in `YYYY-MM-DD` format.

```text
TODAY()
→ "YYYY-MM-DD"
```

When evaluating a formula directly, you can pass `now` in the evaluation context to reproduce the result.

For detailed usage, see the [Core Usage Guide](core.en.md#evaluating-formulas).

### `DATE_ADD`

`DATE_ADD(date, amount, unit?)`

Adds or subtracts the given period from a date.

| Unit | Meaning |
|---|---|
| `"days"` | Days |
| `"months"` | Months |
| `"years"` | Years |

If the unit is omitted, `"days"` is used. The amount must be an integer, and using a negative number subtracts from the date.

```text
DATE_ADD("2026-08-18", 14)
→ "2026-09-01"

DATE_ADD("2026-08-18", -1, "months")
→ "2026-07-18"

DATE_ADD("2026-08-18", 2, "years")
→ "2028-08-18"
```

If the same date does not exist in the result of adding months or years, the last day of the target month is used.

```text
DATE_ADD("2026-01-31", 1, "months")
→ "2026-02-28"

DATE_ADD("2024-01-31", 1, "months")
→ "2024-02-29"
```

### `DATE_DIFF`

`DATE_DIFF(startDate, endDate, unit?)`

Returns the difference of the end date minus the start date.

| Unit | Result |
|---|---|
| `"days"` | The number of days between the two dates |
| `"months"` | The number of completed months |
| `"years"` | The number of completed years |

If the unit is omitted, `"days"` is used.

```text
DATE_DIFF("2026-08-01", "2026-08-18")
→ 17

DATE_DIFF("2026-01-31", "2026-03-01", "months")
→ 1

DATE_DIFF("2024-08-18", "2026-08-17", "years")
→ 1
```

If the end date is earlier than the start date, it returns a negative number.

## Tax functions

### `VAT`

`VAT(supplyAmount, rate?)`

Computes the VAT amount for a supply amount. If the rate is omitted, `10` is used.

The rate is specified as a percentage number.

```text
VAT(10000)
→ 1000

VAT(10000, 8)
→ 800
```

`VAT` does not automatically round or truncate the result. Combine the processing method you need explicitly.

```text
FLOOR(VAT(12345))
→ 1234

ROUND(VAT(12345))
→ 1235
```

Only a number of `0` or more can be used for the rate.

> [!IMPORTANT]
> `VAT` is a simple computation function using the supply amount and the rate.
> The tax classification, exemptions, multiple rates, computation unit, and rounding policy needed for actual tax processing must be decided by your application.

## Type conversion functions

### `TO_NUMBER`

`TO_NUMBER(value)`

Converts a value to a number.

| Input | Result |
|---|---|
| Number | The same number |
| Numeric-format string | The converted number |
| `TRUE` | `1` |
| `FALSE` | `0` |
| Empty value | `0` |
| Empty string | `0` |

```text
TO_NUMBER("1500")
→ 1500

TO_NUMBER("-3.5")
→ -3.5

TO_NUMBER(TRUE)
→ 1
```

Leading and trailing whitespace is removed before conversion. Decimal and exponent notation are supported, but the following strings are not converted to numbers.

- A value containing a thousands separator: `"1,500"`
- Hexadecimal: `"0x1F"`
- Infinity: `"Infinity"`
- A non-numeric string: `"amount"`

If you need to convert a value containing a thousands separator, remove the separator first.

```text
TO_NUMBER(REPLACE("1,500", ",", ""))
→ 1500
```

A range cannot be converted to a number.

### `TO_STRING`

`TO_STRING(value)`

Converts numbers, booleans, and empty values to strings.

| Input | Result |
|---|---|
| `1500` | `"1500"` |
| `TRUE` | `"TRUE"` |
| `FALSE` | `"FALSE"` |
| Empty value | `""` |
| String | The original string |

A range cannot be converted to a string.

```text
TO_STRING(3) = "3"
→ TRUE
```

### `TO_DATE`

`TO_DATE(value)`

Validates a date string and converts it to `YYYY-MM-DD` format in UTC.

```text
TO_DATE("2026-01-05")
→ "2026-01-05"

TO_DATE("2026-01-05T09:30:00Z")
→ "2026-01-05"
```

A date that does not actually exist, or a value that cannot be interpreted as a date, is treated as an error.

## Checking errors

Formula errors are broadly divided into two kinds.

| Kind | Example |
|---|---|
| Syntax error | Unclosed parenthesis, invalid character, unsupported function |
| Computation error | Type mismatch, division by zero, invalid date |

In the designer, the formula editor shows syntax errors and the computed result using sample values. When a condition can be evaluated with the sample values, the designer also checks that its result is a boolean.

If a display-value formula fails while generating a PDF, SlipKit reports a rendering error that identifies the field, grid cell, or barcode.

An invalid conditional-format expression, or one that returns a non-boolean value, also causes a rendering error. If a condition cannot be evaluated because a required value is missing, a type does not match, or a similar computation error occurs, SlipKit skips that rule and continues rendering.

### Common problems

| Problem | What to check |
|---|---|
| A type error occurs in a numeric computation | Check whether the parameter type is a number, and use `TO_NUMBER` if it is a string |
| An error says a range cannot be used directly | Use an aggregation function such as `SUM` or `AVG` |
| The formula result is empty | Check the parameter name and the sample data |
| An error says the function does not exist | Check the supported-function list in this document |
| A date computation differs from expectation | Check whether the input is in ISO format and in UTC |
| Barcode rendering fails | Check whether the formula result matches the format of the selected barcode type |
| A `COUNTIF` result is larger than expected | Check whether the `<>` condition includes empty values |
| `3 = "3"` comes out false | Convert to the same type before comparing |

> [!TIP]
> After writing a formula, enter sample data as close to reality as possible and check normal values, empty values, and the case with no list together.

## Formula limits

For safe execution, the following limits apply.

| Item | Limit |
|---|---:|
| Formula string length | Up to 10,000 characters |
| Formula nesting depth | Up to 100 levels |
| Value data nesting depth | Up to 256 levels |

A formula or value that exceeds a limit is treated as an error.

Formulas cannot use the following.

- Arbitrary JavaScript execution
- Calling user-defined functions
- Returning object values directly
- Direct arithmetic operations on a range
- The `==`, `!=`, `&&`, `||` operators
- External API or network calls

## Completion check

Before applying a formula, check the following.

- [ ] Reference the parameter and list-field names exactly.
- [ ] Use number-type values in numeric computations.
- [ ] Convert with `TO_NUMBER` if there are string numbers.
- [ ] Use list ranges together with aggregation functions.
- [ ] Check the result when values and lists are empty.
- [ ] Specify the rounding or truncation method for tax.
- [ ] Confirm that dates are in ISO format and in UTC.
- [ ] Check the result with sample data in the designer.
- [ ] Confirm that barcode formula results match the barcode format rules.
- [ ] Check the final display result in the PDF preview.

## Related documents

- [Form Designer Usage Guide](designer.en.md)
- [Core Usage Guide](core.en.md)
- [Configuration Guide](configuration.en.md)
- [API Reference](api-reference.en.md)
- [Guide list](README.en.md)
