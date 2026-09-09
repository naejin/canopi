using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 3 || new Uri(args[0]).Host != "127.0.0.1")
            throw new ArgumentException("Expected localhost URL, output directory and script");
        string output = Path.GetFullPath(args[1]);
        if (Directory.Exists(output)) throw new IOException("Output directory already exists");
        Directory.CreateDirectory(output);
        string script = File.ReadAllText(args[2]);
        bool success = false;
        Application.EnableVisualStyles();
        using var form = new Form { Text = "Canopi PDF native runtime probe", Width = 1100, Height = 800 };
        using var view = new WebView2 { Dock = DockStyle.Fill };
        using var timer = new System.Windows.Forms.Timer { Interval = 120_000 };
        form.Controls.Add(view);
        void Fail(Exception error) { Console.Error.WriteLine(error); timer.Stop(); form.Close(); }
        timer.Tick += (_, _) => Fail(new TimeoutException("Native PDF probe timed out"));
        form.Load += async (_, _) =>
        {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: Path.Combine(output, "webview-profile"));
                await view.EnsureCoreWebView2Async(environment);
                view.CoreWebView2.WebMessageReceived += (_, message) =>
                {
                    try
                    {
                        if (new Uri(message.Source).Authority != new Uri(args[0]).Authority)
                            throw new InvalidDataException("Unexpected message origin");
                        string text = message.TryGetWebMessageAsString();
                        if (text.Length > 10_000_000) throw new InvalidDataException("Oversized fixture result");
                        using var payload = JsonDocument.Parse(text);
                        var data = payload.RootElement;
                        if (data.TryGetProperty("error", out var error)) throw new InvalidDataException(error.GetString());
                        File.WriteAllBytes(Path.Combine(output, "pdfkit.pdf"), Convert.FromBase64String(data.GetProperty("pdf").GetString()!));
                        File.WriteAllText(Path.Combine(output, "pdfkit.json"), data.GetProperty("report").GetRawText());
                        var previews = data.GetProperty("previews");
                        if (previews.GetArrayLength() != 3) throw new InvalidDataException("Expected three previews");
                        for (int index = 0; index < 3; index++)
                            File.WriteAllBytes(Path.Combine(output, $"preview-{index + 1}.png"), Convert.FromBase64String(previews[index].GetString()!));
                        File.WriteAllText(Path.Combine(output, "runtime.json"), JsonSerializer.Serialize(new
                        {
                            host = "WinForms WebView2", os = Environment.OSVersion.ToString(),
                            engine = environment.BrowserVersionString, sdk = "1.0.2903.40",
                            delivery = "Native fixed-path binary write; no save dialog"
                        }));
                        success = true;
                        timer.Stop();
                        form.Close();
                    }
                    catch (Exception error) { Fail(error); }
                };
                view.CoreWebView2.NavigationCompleted += async (_, navigation) =>
                {
                    try
                    {
                        if (!navigation.IsSuccess) throw new IOException($"Navigation failed: {navigation.WebErrorStatus}");
                        if (view.CoreWebView2.Source.StartsWith(args[0], StringComparison.Ordinal))
                            await view.CoreWebView2.ExecuteScriptAsync(script);
                    }
                    catch (Exception error) { Fail(error); }
                };
                view.CoreWebView2.Navigate(args[0]);
            }
            catch (Exception error) { Fail(error); }
        };
        timer.Start();
        Application.Run(form);
        Environment.ExitCode = success ? 0 : 1;
    }
}
