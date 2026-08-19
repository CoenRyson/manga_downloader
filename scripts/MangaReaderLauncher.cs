using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class MangaReaderLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            var root = AppDomain.CurrentDomain.BaseDirectory;
            var script = Path.Combine(root, "Manga Reader Local.ps1");
            if (!File.Exists(script))
            {
                throw new FileNotFoundException("Soubor Manga Reader Local.ps1 nebyl nalezen.", script);
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Manga Reader Local", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
