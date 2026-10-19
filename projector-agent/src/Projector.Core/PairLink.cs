namespace Lecturer.Projector;

public sealed record PairLink(Uri Origin, string Code)
{
    public static PairLink Parse(string value)
    {
        if (value.Length > 2048 || !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != "lecturer-projector" || uri.Host != "pair" || uri.Port != -1 ||
            uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath is not ("" or "/"))
            throw new InvalidDataException("INVALID_PAIR_LINK");
        var pairs = uri.Query.TrimStart('?').Split('&').Select(piece => piece.Split('=', 2)).ToArray();
        if (pairs.Length != 2 || pairs.Any(pair => pair.Length != 2) || pairs.Select(pair => pair[0]).Distinct(StringComparer.Ordinal).Count() != 2)
            throw new InvalidDataException("INVALID_PAIR_LINK");
        var fields = pairs.ToDictionary(pair => pair[0], pair => Uri.UnescapeDataString(pair[1]), StringComparer.Ordinal);
        if (!fields.TryGetValue("origin", out var origin) || !fields.TryGetValue("code", out var code) ||
            code.Length != 12 || !code.All(char.IsAsciiLetterOrDigit)) throw new InvalidDataException("INVALID_PAIR_LINK");
        return new(PublicScene.ValidateOrigin(origin), code);
    }
}
