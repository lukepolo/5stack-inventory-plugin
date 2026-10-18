#!/usr/bin/env python3
"""Run the actual embedded paint texture stage against PNG/float fixtures."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import ast,glob,hashlib,os,re,shutil,struct,subprocess,tempfile,time,unittest

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(os.environ.get('INVENTORY_TEST_SCRIPT',ROOT/'scripts/extract-models.sh')).read_text()
PROGRAM=SOURCE.split('PAINT_DEST="$PAINT_DEST" python3 - <<\'PYEOF\'\n',1)[1].split('\nPYEOF',1)[0]
TREE=ast.parse(PROGRAM)
NAMES={'out_name','asset_url','is_exr','restore_float_texture_names','extract_textures'}
FUNCTIONS=[n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name in NAMES]
CODE=compile(ast.Module(body=FUNCTIONS,type_ignores=[]),'<real paint stage>','exec')
MISSING=next(n for n in TREE.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='missing' for t in n.targets))
FILTER=compile(ast.Module(body=[MISSING],type_ignores=[]),'<real cache filter>','exec')
FLOAT=b'\x76\x2f\x31\x01'+struct.pack('<4f',-123.5,0.0001,65504.0,-0.25)
PNG=b'\x89PNG\r\n\x1a\n'+b'color-under-zero-alpha'

class PaintTextures(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.tex=self.root/'textures';self.tex.mkdir();self.calls=[];self.updates=[];self.fixtures={};self.fail_png=False
  self.ns={**globals(),'texture_names':{},'wanted_name':{},'tex_dir':str(self.tex),'raw':str(self.root/'raw'),'cli':'recording-cli','vpk':'fixture.vpk','BATCH':2,'CORES':2,'have_cwebp':True,'failed':[],
   'pool_size':lambda *a:2,'progress':lambda *a,**kw:self.updates.append((a,kw)),'recover_unsupported':lambda paths:None}
  exec(CODE,self.ns)
 def run_cli(self,args,**kw):
  self.calls.append(args)
  if args[0]=='recording-cli':
   for p in args[args.index('-f')+1].split(','):
    suffix,data=self.fixtures[p];f=Path(self.ns['raw'])/(p.removesuffix('.vtex_c')+suffix);f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data)
  elif args[0]=='cwebp':
   self.assertEqual(args[1:5],['-exact','-lossless','-q','100']);source=Path(args[5]);self.assertFalse(source.read_bytes().startswith(FLOAT[:4]),'float data reached cwebp')
   if self.fail_png:raise subprocess.CalledProcessError(7,args)
   Path(args[args.index('-o')+1]).write_bytes(b'RIFFWEBP'+source.read_bytes())
  else:self.fail('unexpected command')
  return subprocess.CompletedProcess(args,0,b'',b'')
 def extract(self,paths):
  with patch('subprocess.run',side_effect=self.run_cli):return self.ns['extract_textures'](paths,'paint-chain')
 def missing(self,paths):
  self.ns['textures']=set(paths)
  if 'restore_float_texture_names' in self.ns:self.ns['restore_float_texture_names'](paths,str(self.tex))
  exec(FILTER,self.ns);return self.ns['missing']
 def test_float_bytes_survive_with_or_without_cwebp(self):
  for encoder in [True,False]:
   with self.subTest(encoder=encoder):
    self.ns['have_cwebp']=encoder;p=f'position/{encoder}.vtex_c';self.fixtures[p]=('.exr',FLOAT)
    self.assertEqual(self.extract([p])[0],1);name=self.ns['out_name'](p,'vtex');self.assertTrue(name.endswith('.exr'));self.assertEqual((self.tex/name).read_bytes(),FLOAT)
    self.assertEqual(self.ns['asset_url'](p,'vtex'),'/textures/'+name)
  self.assertFalse(any(c[0]=='cwebp' for c in self.calls))
 def test_mixed_batches_use_real_names_and_preserve_png_encoding(self):
  paths=['a/pos.vtex_c','b/pos.vtex_c','c/color.vtex_c'];self.fixtures={p:('.png',PNG) if 'color' in p else ('.exr',FLOAT) for p in paths}
  self.assertEqual(self.extract(paths)[0],3)
  names=[self.ns['out_name'](p,'vtex') for p in paths];self.assertEqual(len(set(names)),3)
  self.assertEqual([Path(n).suffix for n in names],['.exr','.exr','.webp'])
  self.assertEqual((self.tex/names[-1]).read_bytes(),b'RIFFWEBP'+PNG)
  self.assertEqual(len([c for c in self.calls if c[0]=='cwebp']),1)
  self.assertFalse(list(self.tex.glob('*.tmp')))
 def test_png_without_encoder_keeps_existing_lossless_fallback(self):
  self.ns['have_cwebp']=False;p='colors/data.vtex_c';self.fixtures[p]=('.png',PNG);self.extract([p]);self.assertEqual((self.tex/self.ns['out_name'](p,'vtex')).read_bytes(),PNG)
 def test_real_exr_cache_skips_cli_and_keeps_format(self):
  p='a/position.vtex_c';name=Path(self.ns['out_name'](p,'vtex')).with_suffix('.exr').name;(self.tex/name).write_bytes(FLOAT)
  self.assertEqual(self.missing([p]),[]);self.assertEqual(self.ns['out_name'](p,'vtex'),name);self.assertFalse(self.calls)
 def test_legacy_misnamed_exr_is_copied_without_mutating_live_hardlink(self):
  p='a/position.vtex_c';old=self.tex/self.ns['out_name'](p,'vtex');live=self.root/'live.webp';live.write_bytes(FLOAT);os.link(live,old);inode=live.stat().st_ino
  self.assertEqual(self.missing([p]),[]);new=self.tex/self.ns['out_name'](p,'vtex')
  self.assertEqual(new.suffix,'.exr');self.assertEqual(new.read_bytes(),FLOAT);self.assertNotEqual(new.stat().st_ino,inode)
  self.assertEqual(live.stat().st_ino,inode);self.assertEqual(old.read_bytes(),FLOAT);self.assertFalse(list(self.tex.glob('*.tmp')))
 def test_corrupt_exr_cache_does_not_hide_missing_texture(self):
  p='a/position.vtex_c';name=Path(self.ns['out_name'](p,'vtex')).with_suffix('.exr').name;(self.tex/name).write_bytes(b'not EXR')
  self.assertEqual(self.missing([p]),[p])
 def test_png_cache_and_catalog_names_stay_unchanged(self):
  p='a/icon.vtex_c';self.ns['wanted_name'][p]='catalog-image.webp';(self.tex/'catalog-image.webp').write_bytes(PNG)
  self.assertEqual(self.missing([p]),[]);self.assertEqual(self.ns['asset_url'](p,'vtex'),'/textures/catalog-image.webp')
 def test_float_copy_failure_stops_before_materials_are_published(self):
  p='a/position.vtex_c';self.fixtures[p]=('.exr',FLOAT)
  with patch('shutil.copyfile',side_effect=OSError('fixture write failure')):
   with self.assertRaises(RuntimeError):self.extract([p])
  self.assertFalse(list(self.tex.iterdir()));self.assertNotIn(p,self.ns['texture_names'])
 def test_png_encoding_failure_stays_reported_and_does_not_publish_temp(self):
  self.fail_png=True;p='a/color.vtex_c';self.fixtures[p]=('.png',PNG)
  self.assertEqual(self.extract([p])[0],0);self.assertEqual(len(self.ns['failed']),1);self.assertFalse(list(self.tex.iterdir()))

if __name__=='__main__':unittest.main(verbosity=2)
