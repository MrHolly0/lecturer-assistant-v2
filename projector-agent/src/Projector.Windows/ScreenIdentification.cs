namespace Lecturer.Projector.Windows;

internal sealed class ScreenIdentification : IDisposable
{
    private readonly List<Form> windows = [];
    private readonly System.Windows.Forms.Timer expiration = new() { Interval = 15_000 };
    private bool disposed;

    public ScreenIdentification(Screen[] screens)
    {
        expiration.Tick += (_, _) => Dispose();
        for (var index = 0; index < screens.Length; index++)
        {
            var screen = screens[index];
            var side = Math.Min(240, Math.Min(screen.WorkingArea.Width, screen.WorkingArea.Height) / 2);
            var form = new IdentificationForm((index + 1).ToString()) { FormBorderStyle = FormBorderStyle.None, ShowInTaskbar = false,
                TopMost = true, StartPosition = FormStartPosition.Manual, Opacity = 0.96,
                BackColor = Color.FromArgb(30, 30, 30), ForeColor = Color.White,
                Bounds = new Rectangle(screen.Bounds.X + (screen.Bounds.Width - side) / 2, screen.Bounds.Y + (screen.Bounds.Height - side) / 2, side, side) };
            windows.Add(form); form.Show();
        }
        expiration.Start();
    }

    public void Dispose()
    {
        if (disposed) return; disposed = true;
        expiration.Stop(); expiration.Dispose();
        foreach (var window in windows) { window.Close(); window.Dispose(); }
        windows.Clear();
    }

    private sealed class IdentificationForm(string number) : Form
    {
        protected override bool ShowWithoutActivation => true;
        protected override void OnPaint(PaintEventArgs args)
        {
            base.OnPaint(args);
            using var font = new Font(SystemFonts.DefaultFont.FontFamily, Math.Max(16, ClientSize.Height * 0.46f), FontStyle.Bold, GraphicsUnit.Pixel);
            TextRenderer.DrawText(args.Graphics, number, font, ClientRectangle, ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0084) { message.Result = new IntPtr(-1); return; }
            base.WndProc(ref message);
        }
        protected override CreateParams CreateParams
        {
            get { var value = base.CreateParams; value.ExStyle |= 0x08000000 | 0x00000020; return value; }
        }
    }
}
