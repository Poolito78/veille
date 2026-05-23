import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useConcurrents } from '@/lib/concurrents';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export default function Pivot() {
  const { concurrents, produits, loading } = useConcurrents();
  const [filterCategorie, setFilterCategorie] = useState('all');

  // Collect all categories
  const categories = Array.from(new Set(produits.map(p => p.categorie).filter(Boolean) as string[])).sort();

  // Build pivot: rows = product names unique, cols = competitors
  const prodFiltered = filterCategorie === 'all' ? produits : produits.filter(p => p.categorie === filterCategorie);

  // Group by nom de produit (normalized)
  const productNames = Array.from(new Set(prodFiltered.map(p => p.nom.trim()))).sort();

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (concurrents.length === 0 || produits.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Tableau pivot</h1>
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">Pas encore de données</p>
          <p className="text-sm mt-1">Ajoutez des concurrents et des produits pour voir le tableau comparatif.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tableau pivot</h1>
          <p className="text-sm text-muted-foreground">Comparaison des prix par produit et concurrent</p>
        </div>
        {categories.length > 0 && (
          <div className="sm:ml-auto flex items-center gap-2">
            <Label className="text-sm shrink-0">Catégorie</Label>
            <Select value={filterCategorie} onValueChange={setFilterCategorie}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {productNames.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p>Aucun produit dans cette catégorie.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-4 py-3 font-medium sticky left-0 bg-muted/50 min-w-48 z-10">Produit</th>
                {concurrents.map(c => (
                  <th key={c.id} className="text-center px-4 py-3 font-medium min-w-32 whitespace-nowrap">{c.nom}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {productNames.map(nom => {
                // Find this product across all competitors
                const row = concurrents.map(c => {
                  const p = prodFiltered.find(p => p.nom.trim() === nom && p.concurrentId === c.id);
                  return { concurrent: c, produit: p };
                });

                const prices = row.map(r => r.produit?.prixHT).filter(p => p != null) as number[];
                const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

                return (
                  <tr key={nom} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 sticky left-0 bg-background border-r font-medium">{nom}</td>
                    {row.map(({ concurrent, produit }) => {
                      if (!produit) {
                        return <td key={concurrent.id} className="px-4 py-3 text-center text-muted-foreground">—</td>;
                      }
                      const isMin = produit.prixHT != null && produit.prixHT === minPrice && prices.length > 1;
                      const isMax = produit.prixHT != null && produit.prixHT === maxPrice && prices.length > 1;
                      return (
                        <td key={concurrent.id} className="px-4 py-3 text-center">
                          {produit.prixHT != null ? (
                            <span className={`font-medium ${isMin ? 'text-green-600' : isMax ? 'text-red-500' : ''}`}>
                              {produit.prixHT.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">Prix NC</span>
                          )}
                          {produit.reference && <p className="text-xs text-muted-foreground">{produit.reference}</p>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-600 inline-block" /> Prix le plus bas</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Prix le plus élevé</span>
      </div>
    </div>
  );
}
