# Formula Function Reference

[한국어](formula.md)

All 29 built-in functions in the SlipKit formula engine. Unregistered function names are rejected at parse time.

---

## Aggregation

| Function | Usage | Description |
|---|---|---|
| `SUM` | `SUM(value, ...)` | Sum. Accepts ranges (`items.amount`) |
| `AVG` | `AVG(value, ...)` | Average. Throws if no values |
| `COUNT` | `COUNT(value, ...)` | Count of non-empty items (excludes null and empty strings) |
| `MIN` | `MIN(value, ...)` | Minimum. Returns 0 if no values |
| `MAX` | `MAX(value, ...)` | Maximum. Returns 0 if no values |

```
SUM(items.amount)                → sum of item amounts
SUM(items.amount, shippingFee)   → item total + shipping fee
AVG(items.unitPrice)             → average unit price
COUNT(items.productName)         → number of rows with a product name
MIN(price1, price2, price3)      → smallest of the three values
```

## Conditional Aggregation

| Function | Usage | Description |
|---|---|---|
| `SUMIF` | `SUMIF(criteriaRange, criteria, [sumRange])` | Sum of items matching the criteria. If sumRange is omitted, the criteria range is summed |
| `COUNTIF` | `COUNTIF(range, criteria)` | Count of items matching the criteria |

Criteria use Excel-style strings.

| Criteria | Meaning | Note |
|---|---|---|
| `"food"` | Equals "food" | `=` can be omitted (bare value means equality) |
| `"=food"` | Equals "food" | Same as above |
| `"<>done"` | Not equal to "done" | Inequality |
| `">=10"` | 10 or greater | Numeric comparison |
| `"<1000"` | Less than 1000 | Numeric comparison |

```
SUMIF(items.category, "food", items.amount)    → sum of "food" category
SUMIF(items.amount, ">=10000")                 → sum of amounts ≥ 10,000
COUNTIF(items.status, "done")                   → count of "done" rows
COUNTIF(items.status, "<>done")                 → count of non-"done" rows
```

## Arithmetic

| Function | Usage | Description |
|---|---|---|
| `ROUND` | `ROUND(number, [digits])` | Round. Defaults to integer when digits omitted |
| `FLOOR` | `FLOOR(number, [digits])` | Round down |
| `CEIL` | `CEIL(number, [digits])` | Round up |
| `ABS` | `ABS(number)` | Absolute value |

```
ROUND(1234.567, 2)    → 1234.57
FLOOR(VAT(10000), 0)  → 1000 (truncate VAT)
```

## String

| Function | Usage | Description |
|---|---|---|
| `CONCAT` | `CONCAT(value, ...)` | Concatenate strings |
| `LEFT` | `LEFT(text, [count])` | Extract from left. Defaults to 1 character |
| `RIGHT` | `RIGHT(text, [count])` | Extract from right. Defaults to 1 character |
| `MID` | `MID(text, start, length)` | Extract from position (1-based) |
| `REPLACE` | `REPLACE(text, search, replacement)` | Replace all occurrences |
| `TRIM` | `TRIM(text)` | Remove leading and trailing whitespace |
| `UPPER` | `UPPER(text)` | Convert to uppercase |
| `LOWER` | `LOWER(text)` | Convert to lowercase |

```
CONCAT(businessName, " Corp.")       → "ABC Corp."
LEFT("2026-08-21", 4)                → "2026"
MID("123-45-67890", 5, 2)           → "45"
REPLACE("Draft", "Draft", "Final")   → "Final"
```

## Conditional

| Function | Usage | Description |
|---|---|---|
| `IF` | `IF(condition, trueValue, falseValue)` | Returns trueValue if condition is true, falseValue otherwise. Lazy evaluation |
| `AND` | `AND(condition, ...)` | True if all are true. Lazy (short-circuits on false) |
| `OR` | `OR(condition, ...)` | True if any is true. Lazy (short-circuits on true) |

```
IF(total >= 100000, "bulk", "standard")
IF(AND(quantity > 0, unitPrice > 0), quantity * unitPrice, 0)
```

## Format

| Function | Usage | Description |
|---|---|---|
| `FORMAT_NUMBER` | `FORMAT_NUMBER(number, [fractionDigits])` | Locale-aware number formatting with digit grouping |
| `FORMAT_DATE` | `FORMAT_DATE(date, [pattern])` | Date formatting. Defaults to `YYYY-MM-DD` |
| `NUMBER_TO_KOREAN` | `NUMBER_TO_KOREAN(integer)` | Korean numeral notation for amounts (anti-forgery convention) |

```
FORMAT_NUMBER(1234567)            → "1,234,567" (ko-KR)
FORMAT_NUMBER(0.123, 2)           → "0.12"
FORMAT_DATE("2026-08-21", "YYYY-MM-DD")  → "2026-08-21"
NUMBER_TO_KOREAN(110)             → "일백일십"
```

`FORMAT_DATE` pattern tokens: `YYYY` `YY` `MM` `M` `DD` `D` `HH` `mm` `ss`

## Date

| Function | Usage | Description |
|---|---|---|
| `TODAY` | `TODAY()` | Today's date (`YYYY-MM-DD`) |
| `DATE_ADD` | `DATE_ADD(date, amount, [unit])` | Add to date. Unit: `"days"` (default) / `"months"` / `"years"` |
| `DATE_DIFF` | `DATE_DIFF(start, end, [unit])` | Difference between dates. Unit: `"days"` (default) / `"months"` / `"years"` |

Dates use ISO format strings (`YYYY-MM-DD`).

```
TODAY()                                    → "2026-08-21"
DATE_ADD("2026-08-21", 30)                 → "2026-09-20"
DATE_ADD("2026-01-15", 2, "months")        → "2026-03-15"
DATE_DIFF("2026-01-01", "2026-08-21")      → 232
```

## Tax

| Function | Usage | Description |
|---|---|---|
| `VAT` | `VAT(supplyAmount, [rate])` | Calculate VAT. Rate defaults to 10% |

Use `ROUND`/`FLOOR` for rounding.

```
VAT(10000)                → 1000
VAT(10000, 8)             → 800
FLOOR(VAT(12345), 0)      → 1234  (truncate sub-won)
```

---

## Formula Syntax

- **Strings**: Wrap in double quotes. To include a quote inside a string, double it (`""`)
- **Range references**: `bindingName.columnKey` refers to dynamic table column data (e.g. `items.amount`)
- **Arithmetic**: `+` `-` `*` `/` with parentheses `()` for precedence
- **Comparison**: `=` `<>` `<` `>` `<=` `>=`
