import pathlib
import zipfile

destination = pathlib.Path('.local/artifacts')
destination.mkdir(parents=True, exist_ok=True)
for function, entry in {
    'appointment': 'appointment',
    'appointment_pe': 'worker',
    'appointment_cl': 'worker',
    'retry': 'retry',
}.items():
    name = f'src/handlers/{entry}.cjs'
    source = pathlib.Path('.local/bundle') / name
    with zipfile.ZipFile(destination / f'{function}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(source, name)
    print(f'Packaged {function}')
