namespace Lecturer.Projector;
public static class ReleaseInfo
{
    public static string Version => typeof(ReleaseInfo).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";
}
