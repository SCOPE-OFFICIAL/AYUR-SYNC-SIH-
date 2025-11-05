# File: scripts/discover_ai_mappings.py
# FINAL CORRECTED VERSION - Fixes case-sensitivity bug

import pandas as pd
import os
import json
import numpy as np

# --- DB IMPORTS ---
import sys
sys.path.append(os.getcwd())
from app.db.session import SessionLocal
from app.db.models import ICD11Code, TraditionalTerm, Mapping
# --- END DB IMPORTS ---

def discover_ai_mappings(progress_callback=None):
    """
    Processes raw AI suggestions, transforms them, and INSERTS them directly
    into the PostgreSQL database with standardized lowercase system names.
    
    Args:
        progress_callback: Optional callable that accepts a message string for progress updates
    """
    # --- This initial data processing part remains the same ---
    DATA_PATH = "data/processed"
    DATA_PATH2 = "data/source2"
    SOURCE_DATA_PATH = "data/source"
    SUGGESTED_MAPPINGS_FILE = os.path.join(DATA_PATH2, "suggested_mappings_actual.csv")
    SOURCE_FILES = {
        "Ayurveda": os.path.join(SOURCE_DATA_PATH, "NATIONAL AYURVEDA MORBIDITY CODES.xls"),
        "Siddha": os.path.join(SOURCE_DATA_PATH, "NATIONAL SIDDHA MORBIDITY CODES.xls"),
        "Unani": os.path.join(SOURCE_DATA_PATH, "NATIONAL UNANI MORBIDITY CODES.xls")
    }
    
    print("Starting AI mapping discovery...")
    if not os.path.exists(SUGGESTED_MAPPINGS_FILE):
        print(f"Error: {SUGGESTED_MAPPINGS_FILE} not found.")
        return

    suggested_df = pd.read_csv(SUGGESTED_MAPPINGS_FILE)
    source_dfs = {}
    for system, path in SOURCE_FILES.items():
        if os.path.exists(path):
            try:
                df = pd.read_excel(path)
                # Normalize column names to be resilient to header variations
                df.columns = [str(c).strip() for c in df.columns]
                df['source_row'] = df.index + 2
                source_dfs[system] = df
            except Exception as e:
                print(f"Warning: Could not read source file {path}: {e}")
                continue

    # Helper to find a column name containing both tokens (case-insensitive)
    def find_col_with_tokens(df, tokens):
        toks = [t.lower() for t in tokens]
        for col in df.columns:
            lc = str(col).lower()
            if all(t in lc for t in toks):
                return col
        return None

    merged_data = []
    siddha_fallback_count = 0
    for _, row in suggested_df.iterrows():
        system = row['source_system']
        code = row['source_code']
        new_row = row.to_dict()
        new_row['native_term'] = ""
        new_row['source_description'] = "Not Found in Source File"
        new_row['source_short_definition'] = None
        new_row['source_long_definition'] = None
        new_row['source_row_num'] = None
        if system in source_dfs:
            source_df = source_dfs[system]
            # Determine column names robustly per system
            code_col = None
            # Try to find a likely long-definition column
            def_col = 'Long_definition' if 'Long_definition' in source_df.columns else None
            if not def_col:
                # Fuzzy search for a column containing 'long' and 'def' or 'definition'/'description'
                cand = find_col_with_tokens(source_df, ["long", "def"]) or find_col_with_tokens(source_df, ["long", "definition"]) or find_col_with_tokens(source_df, ["long", "description"]) or find_col_with_tokens(source_df, ["definition"]) or find_col_with_tokens(source_df, ["description"]) 
                def_col = cand
            native_col = None
            if system == 'Ayurveda':
                for cand in ['NAMC_CODE', 'Code', 'CODE']:
                    if cand in source_df.columns:
                        code_col = cand; break
                for cand in ['NAMC_term_DEVANAGARI', 'NAMC_TERM_DEVANAGARI', 'DEVANAGARI', 'Devanagari']:
                    if cand in source_df.columns:
                        native_col = cand; break
            elif system == 'Siddha':
                for cand in ['NSMC_CODE', 'NAMC_CODE', 'Code', 'CODE']:
                    if cand in source_df.columns:
                        code_col = cand; break
                for cand in ['Tamil_term', 'Tamil', 'tamil']:
                    if cand in source_df.columns:
                        native_col = cand; break
            elif system == 'Unani':
                for cand in ['NUMC_CODE', 'NAMC_CODE', 'Code', 'CODE']:
                    if cand in source_df.columns:
                        code_col = cand; break
                for cand in ['Arabic_term', 'Arabic', 'arabic']:
                    if cand in source_df.columns:
                        native_col = cand; break

            if code_col and code_col in source_df.columns:
                match = source_df[source_df[code_col].astype(str) == str(code)]
                if not match.empty:
                    # Extract long and short definitions (if available)
                    long_def = match.iloc[0].get(def_col) if def_col and def_col in match.columns else None
                    short_col = None
                    if system in ['Siddha', 'Unani']:
                        # Try common short-definition header variants
                        for cand in [
                            'Short_definition', 'Short Definition', 'Short_Definition',
                            'Short def', 'Short Def', 'ShortDef', 'ShortDesc',
                            'Short_description', 'Short Description'
                        ]:
                            if cand in source_df.columns:
                                short_col = cand
                                break
                        if not short_col:
                            # Fallback: fuzzy find any column that contains both 'short' and 'def'
                            short_col = find_col_with_tokens(source_df, ["short", "def"]) or find_col_with_tokens(source_df, ["short", "definition"]) or find_col_with_tokens(source_df, ["short", "desc"]) 
                    short_def = match.iloc[0].get(short_col) if short_col and short_col in match.columns else None

                    # Track Siddha fallback if applicable
                    desc = long_def
                    if (pd.isna(desc) or str(desc).strip() == "") and (system == 'Siddha') and short_def is not None and str(short_def).strip() != "":
                        siddha_fallback_count += 1
                        desc = short_def

                    # Assign per-field and legacy description
                    new_row['source_long_definition'] = None if (pd.isna(long_def) or str(long_def).strip() == "") else long_def
                    new_row['source_short_definition'] = None if (pd.isna(short_def) or str(short_def).strip() == "") else short_def
                    new_row['source_description'] = desc if not (pd.isna(desc) or str(desc).strip() == "") else "N/A"
                    new_row['source_row_num'] = match.iloc[0]['source_row']
                    new_row['native_term'] = match.iloc[0].get(native_col, "")
        merged_data.append(new_row)

    merged_df = pd.DataFrame(merged_data).replace({np.nan: None})
    print("Grouping suggestions by ICD name...")

    db = SessionLocal()
    try:
        icd_cache = {}
        term_cache = {}
        updated_terms = 0
        
        print("Writing suggestions to the database...")
        i = 0
        total_icds = len(merged_df.groupby('suggested_icd_name'))
        for icd_name, group in merged_df.groupby('suggested_icd_name'):
            if not icd_name: continue
            
            i = i + 1
            progress_msg = f"[{i}/{total_icds}] Processing ICD: {icd_name}"
            print(progress_msg)
            if progress_callback:
                progress_callback(progress_msg)

            if icd_name not in icd_cache:
                icd_code_obj = db.query(ICD11Code).filter(ICD11Code.icd_name == icd_name).first()
                if not icd_code_obj:
                    icd_code_obj = ICD11Code(icd_name=icd_name, status='Pending')
                    db.add(icd_code_obj)
                    db.flush()
                icd_cache[icd_name] = icd_code_obj
            icd_code_obj = icd_cache[icd_name]

            for _, suggestion_row in group.iterrows():
                system = suggestion_row.get('source_system')
                term_name = suggestion_row.get('source_term')
                term_code = suggestion_row.get('source_code')
                
                if not system or not term_name or not term_code: continue

                # --- THE FIX IS HERE ---
                # We standardize the system name to lowercase before using it.
                system_lower = system.lower()
                # --- END OF FIX ---

                term_key = (system_lower, term_name, term_code)
                if term_key not in term_cache:
                    term_obj = db.query(TraditionalTerm).filter_by(system=system_lower, term=term_name, code=term_code).first()
                    if not term_obj:
                        term_obj = TraditionalTerm(
                            system=system_lower,  # Use the lowercase version
                            term=term_name,
                            code=term_code,
                            source_short_definition=suggestion_row.get('source_short_definition'),
                            source_long_definition=suggestion_row.get('source_long_definition'),
                            source_description=suggestion_row.get('source_description'),
                            source_row=int(suggestion_row['source_row_num']) if suggestion_row['source_row_num'] is not None else None,
                            devanagari=suggestion_row.get('native_term') if system == 'Ayurveda' else None,
                            tamil=suggestion_row.get('native_term') if system == 'Siddha' else None,
                            arabic=suggestion_row.get('native_term') if system == 'Unani' else None
                        )
                        db.add(term_obj)
                        db.flush()
                    else:
                        # Update existing term if missing critical fields (especially Siddha source_description)
                        updated = False
                        if not term_obj.source_description or str(term_obj.source_description).strip() in ("", "Not Found in Source File", "N/A"):
                            new_desc = suggestion_row.get('source_description')
                            if new_desc and str(new_desc).strip() not in ("", "Not Found in Source File", "N/A"):
                                term_obj.source_description = new_desc
                                updated = True
                        # Backfill short/long definitions when missing
                        if (not getattr(term_obj, 'source_short_definition', None)) and suggestion_row.get('source_short_definition'):
                            term_obj.source_short_definition = suggestion_row.get('source_short_definition')
                            updated = True
                        if (not getattr(term_obj, 'source_long_definition', None)) and suggestion_row.get('source_long_definition'):
                            term_obj.source_long_definition = suggestion_row.get('source_long_definition')
                            updated = True
                        if (term_obj.source_row is None) and (suggestion_row.get('source_row_num') is not None):
                            term_obj.source_row = int(suggestion_row['source_row_num'])
                            updated = True
                        # Update native language fields if missing
                        if system == 'Ayurveda' and not term_obj.devanagari and suggestion_row.get('native_term'):
                            term_obj.devanagari = suggestion_row.get('native_term')
                            updated = True
                        if system == 'Siddha' and not term_obj.tamil and suggestion_row.get('native_term'):
                            term_obj.tamil = suggestion_row.get('native_term')
                            updated = True
                        if system == 'Unani' and not term_obj.arabic and suggestion_row.get('native_term'):
                            term_obj.arabic = suggestion_row.get('native_term')
                            updated = True
                        if updated:
                            updated_terms += 1
                            db.flush()
                    term_cache[term_key] = term_obj
                term_obj = term_cache[term_key]
                
                existing_mapping = db.query(Mapping).filter_by(icd11_code_id=icd_code_obj.id, traditional_term_id=term_obj.id).first()
                if not existing_mapping:
                    confidence_str = str(suggestion_row.get('confidence_score', '')).strip().replace('%', '')
                    confidence_int = int(confidence_str) if confidence_str.isdigit() else None
                    new_mapping = Mapping(
                        icd11_code_id=icd_code_obj.id,
                        traditional_term_id=term_obj.id,
                        status='suggested',
                        is_primary=False,
                        ai_justification=suggestion_row.get('justification'),
                        ai_confidence=confidence_int
                    )
                   
                    db.add(new_mapping)
        
        print("Committing all new records to the database...")
        db.commit()
        print(f"Database successfully populated with suggestions.")
        if siddha_fallback_count:
            print(f"Applied Siddha short-definition fallback for {siddha_fallback_count} terms.")
        if updated_terms:
            print(f"Updated existing TraditionalTerm rows: {updated_terms}.")

    except Exception as e:
        print(f"An error occurred during database operation: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    discover_ai_mappings()