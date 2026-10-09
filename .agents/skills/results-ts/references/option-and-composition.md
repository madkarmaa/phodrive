# Option and container composition

## Absence is explicit

Call `None()` to create an absent value. Use `None<T>()` to give an empty Option a type for later operations. `Some(null)` and `Some(undefined)` are present values. Constructors do not convert nullish input to None.

```typescript
import { None, Some, type Option } from 'results-ts';

const fromNullable = <T>(value: T | null | undefined): Option<T> =>
    value === null || value === undefined ? None<T>() : Some(value);

const label = fromNullable('  Ada  ')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .unwrapOr('anonymous');
// label is 'Ada'. Falsy values such as 0 and false are still present.
```

`fromNullable` above is a local adapter, not a results-ts export. Use an existing project adapter if available.

Convert absence to a domain error with `okOr` or `okOrElse`. `okOrElse` computes its error only for None. Use `okOrElseAsync` if computing the error requires async work. It returns AsyncResult.

Return `AsyncOption<T>` from async Option APIs so callers can chain before awaiting:

```typescript
import { None, Some, type AsyncOption } from 'results-ts';

const normalizeName = (input: string): AsyncOption<string> =>
    Some(input)
        .mapAsync(async (value) => value.trim())
        .andThen((value) => (value.length > 0 ? Some(value) : None<string>()));

const displayName = await normalizeName('  Ada  ')
    .map((value) => value.toUpperCase())
    .unwrapOr('anonymous');
// displayName is 'ADA'.
```

## Mutation and aliases

These synchronous Option methods mutate the receiver:

| Method                          | Effect                                   | Return                                  |
| ------------------------------- | ---------------------------------------- | --------------------------------------- |
| `insert(value)`                 | Replace with Some                        | New payload                             |
| `getOrInsert(value)`            | Insert only on None                      | Current payload                         |
| `getOrInsertWith(factory)`      | Compute and insert only on None          | Current payload                         |
| `getOrInsertWithAsync(factory)` | Await and insert on None                 | Promise of payload                      |
| `take()`                        | Remove the value                         | Previous Option                         |
| `takeIf(predicate)`             | Remove if present and predicate succeeds | Removed value as Option, otherwise None |
| `replace(value)`                | Replace with Some                        | Previous Option                         |

Aliases to the same Option see these mutations. `const` prevents variable reassignment but does not prevent Option mutation. Result methods may return the original container. The library does not deep-clone payload objects, so a transformation does not guarantee a copy.

```typescript
import { None } from 'results-ts';

const cached = None<number>();
const initial = cached.getOrInsertWith(() => 42); // Returns 42 and sets cached to Some(42).
const removed = cached.take(); // Returns Some(42) and leaves cached as None.
const fallback = cached.unwrapOr(0); // Returns 0.
```

AsyncOption has none of the mutation methods listed above. Await it to get an Option if you need to mutate it. Concurrent calls to a synchronous Option's `getOrInsertWithAsync` share the pending factory call. Test the intended order before mixing this operation with other mutations.

## Nesting and tuples

Use `andThen` to avoid nesting. Use `flatten()` to remove one layer from `Result<Result<T, F>, E>` or `Option<Option<T>>`. Result flattening preserves `E | F`. `transpose()` swaps Result and Option nesting:

| Input                  | Output                 |
| ---------------------- | ---------------------- |
| `Option<Result<T, E>>` | `Result<Option<T>, E>` |
| `Some(Ok(value))`      | `Ok(Some(value))`      |
| `Some(Err(error))`     | `Err(error)`           |
| `None`                 | `Ok(None)`             |
| `Result<Option<T>, E>` | `Option<Result<T, E>>` |
| `Ok(Some(value))`      | `Some(Ok(value))`      |
| `Ok(None)`             | `None`                 |
| `Err(error)`           | `Some(Err(error))`     |

Call these methods only on containers with the required nesting. Do not cast a container to bypass that requirement. Invalid inner values can throw at runtime.

`Option.zip(other)` returns Some containing a tuple only when both values are present. `unzip()` requires an Option containing a two-element tuple and returns two Options. Specify the tuple type if TypeScript would otherwise infer an array.

```typescript
import { None, Some, type Option, type Result } from 'results-ts';

const combined = Some(1).zip(Some('Ada')); // Option<[number, string]>.
const parts = combined.unzip(); // [Option<number>, Option<string>].
const absent: Option<Result<number, string>> = None();
const transposed: Result<Option<number>, string> = absent.transpose();
// transposed is Ok(None), so an optional missing value is not an error.
```

Read the Option API section in [llms.txt](https://results-ts.madkarma.top/llms.txt) for fallback types and mutation behavior. Check signatures against the installed declarations.
