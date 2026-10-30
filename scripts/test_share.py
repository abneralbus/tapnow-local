import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('share', Path(__file__).with_name('export-share.py'))
share = importlib.util.module_from_spec(spec)
spec.loader.exec_module(share)


class ShareTests(unittest.TestCase):
    def test_excludes_private_files_dependencies_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            for name in ['README.md', 'src/App.jsx', '.env.example', 'config/flow.env.example',
                         'data/accounts.json', '.env', '.env.production', 'vendor/pkg/.env',
                         'vendor/pkg/data/accounts.json', 'node_modules/secret.js',
                         'src/local.log', 'VERIFICATION.md']:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(name)
            (root / 'src/App.jsx').chmod(0o755)
            (root / 'src/leak.js').symlink_to(root / '.env')
            (root / 'src/link').symlink_to(root / 'data', target_is_directory=True)
            notebook = root / 'colab/test.ipynb'
            notebook.parent.mkdir()
            notebook.write_text(json.dumps({'metadata': {'secret': 'x'}, 'cells': [
                {'cell_type': 'code', 'source': ['print(1)'], 'metadata': {'private': 'x'},
                 'execution_count': 5, 'outputs': [{'text': 'secret result'}]}]}))
            destination = Path(directory) / 'share'
            count, archive = share.export(root, destination)
            self.assertEqual(count, 5)
            self.assertEqual((destination / "src/App.jsx").stat().st_mode & 0o777, 0o755)
            with zipfile.ZipFile(archive) as bundle:
                self.assertEqual(len(bundle.namelist()), 5)
                self.assertFalse(any('/data/' in name or 'leak' in name for name in bundle.namelist()))
            value = json.loads((destination / 'colab/test.ipynb').read_text())
            self.assertEqual(value['cells'][0]['outputs'], [])
            self.assertEqual(value['metadata'], {})
            with self.assertRaises(FileExistsError):
                share.export(root, destination)
            with self.assertRaises(ValueError):
                share.export(root, root / 'nested')

    def test_rejects_key_in_vendor_without_partial_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            file = root / 'vendor/pkg/client.py'
            file.parent.mkdir(parents=True)
            key = 'AI' + 'za' + 'x' * 35
            file.write_text('API_KEY = ' + repr(key))
            destination = Path(directory) / 'share'
            with self.assertRaises(ValueError) as caught:
                share.export(root, destination)
            self.assertIn('vendor/pkg/client.py', str(caught.exception))
            self.assertNotIn(key, str(caught.exception))
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_suffix('.zip').exists())


if __name__ == '__main__':
    unittest.main()
