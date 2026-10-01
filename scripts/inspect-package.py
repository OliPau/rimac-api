import pathlib
import sys
import zipfile

directory = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.serverless')
archives = list(directory.glob('*.zip'))
if not archives:
    sys.exit('No Lambda archives found')

for archive in archives:
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        forbidden = [name for name in names if (
            name.endswith(('.md', '.pdf', '.ts', '.map'))
            or any(part in name.lower() for part in ['.env', 'openapi', 'coverage/', 'delivery/', 'tests/'])
        )]
        if forbidden:
            sys.exit(f'Unexpected package files in {archive}: {forbidden}')
        if not any(name.endswith(('.js', '.cjs', '.mjs')) for name in names):
            sys.exit(f'Missing executable code in {archive}')
        print(f'{archive.name}: {len(names)} files, {sum(item.file_size for item in bundle.infolist())} bytes, clean')
